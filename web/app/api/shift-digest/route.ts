// POST /api/shift-digest — generate and store a GM shift digest.
//
// Auth: a manager/admin session, OR the scheduled worker path:
//   Authorization: Bearer <CRON_SECRET> with JSON body { business_id }.
// The worker path uses the owner pool (server-side only) because there is no
// user session, so RLS would deny everything. The session path runs inside a
// single RLS-scoped withUser transaction.
//
// The Anthropic SDK usage, CRON_SECRET check, dedup prompt, and traceability
// (source_entry_ids) are unchanged from the original.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionUser } from '@/lib/auth';
import { db, withUser, type QueryFn } from '@/lib/db';
import { sourceLabel } from '@/components/shift-log/types';

/** Owner-pool query shaped as a QueryFn for the worker path. */
const ownerQ: QueryFn = async (text, params) => {
  const r = await db.query(text, params);
  return { rows: r.rows, rowCount: r.rowCount ?? 0 };
};

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** pg hands back Date objects; the digest logic works on ISO/day strings. */
function toDay(value: unknown): string {
  return new Date(value as string | Date).toISOString().slice(0, 10);
}

function toISO(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

async function runDigest(
  q: QueryFn,
  businessId: string
): Promise<NextResponse> {
  /* Business + digest schedule (narrowed locally from jsonb) ------------------- */
  const businessRow = (
    await q('SELECT id, digest_schedule FROM businesses WHERE id = $1 LIMIT 1', [
      businessId,
    ])
  ).rows[0] as { id: string; digest_schedule: Record<string, unknown> | null } | undefined;
  if (!businessRow) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }
  const scheduleRaw = businessRow.digest_schedule ?? {};
  const schedule = {
    enabled: scheduleRaw.enabled !== false,
    time: typeof scheduleRaw.time === 'string' ? scheduleRaw.time : '18:00',
    timezone:
      typeof scheduleRaw.timezone === 'string'
        ? scheduleRaw.timezone
        : 'America/Chicago',
  };

  /* Digest period: since the last digest, or the last 24h if none ------------- */
  const lastDigestRow = (
    await q(
      'SELECT period_end, created_at FROM shift_digests WHERE business_id = $1 ORDER BY period_end DESC, created_at DESC LIMIT 1',
      [businessId]
    )
  ).rows[0] as { period_end: unknown; created_at: unknown } | undefined;
  const lastDigest = lastDigestRow
    ? {
        period_end: toDay(lastDigestRow.period_end),
        created_at: toISO(lastDigestRow.created_at),
      }
    : null;

  const now = new Date();
  const periodEnd = dateOnly(now);
  const periodStart =
    lastDigest?.period_end ?? dateOnly(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  /* New entries + open action items created since the last digest --------------- */
  const entryRows = (
    await q(
      'SELECT e.id, e.shift_date, e.body, e.source, e.created_at, e.user_id, u.name AS author_name ' +
        'FROM shift_entries e LEFT JOIN users u ON u.id = e.user_id ' +
        'WHERE e.business_id = $1 AND e.shift_date >= $2 ' +
        'ORDER BY e.shift_date ASC, e.created_at ASC LIMIT 500',
      [businessId, periodStart]
    )
  ).rows;

  const rows = entryRows.map((row) => ({
    id: row.id as string,
    shift_date: toDay(row.shift_date),
    body: row.body as string,
    source: row.source as string,
    created_at: toISO(row.created_at),
    author_name: (row.author_name as string | null) ?? null,
  }));

  // Entries with shift_date strictly after the last digest period end. Entries
  // dated on the period-end day itself are included only if they were created
  // after that digest ran, so late-evening notes are never skipped.
  const entries = rows.filter((row) => {
    if (row.shift_date > periodStart) return true;
    if (
      lastDigest &&
      row.shift_date === periodStart &&
      row.created_at > lastDigest.created_at
    ) {
      return true;
    }
    return false;
  });

  const sinceTs = lastDigest
    ? lastDigest.created_at
    : new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const itemRows = (
    await q(
      "SELECT id, title, due_date, escalation_days, escalated, flagged_next, created_at FROM shift_action_items WHERE business_id = $1 AND status = 'open' AND created_at >= $2 ORDER BY due_date ASC LIMIT 200",
      [businessId, sinceTs]
    )
  ).rows;
  const items = itemRows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    due_date: toDay(row.due_date),
    escalation_days: Number(row.escalation_days),
    escalated: Boolean(row.escalated),
    flagged_next: Boolean(row.flagged_next),
    created_at: toISO(row.created_at),
  }));

  if (entries.length === 0 && items.length === 0) {
    return NextResponse.json({ digest: null, reason: 'no new entries' });
  }

  /* LLM summary ----------------------------------------------------------------- */
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 503 });
  }

  const prompt =
    'Summarize these shift-log entries and open action items for the GM. ' +
    'Deduplicate: multiple entries about the same issue = one item. ' +
    'Sections: Key issues, Action items status, Notes.\n\n' +
    'Shift-log entries:\n' +
    JSON.stringify(
      entries.map((entry) => ({
        date: entry.shift_date,
        time: entry.created_at,
        author: entry.author_name ?? 'System',
        source: sourceLabel(entry.source),
        body: entry.body,
      }))
    ) +
    '\n\nOpen action items:\n' +
    JSON.stringify(
      items.map((item) => ({
        title: item.title,
        due_date: item.due_date,
        escalated: item.escalated,
        flagged_for_next_manager: item.flagged_next,
      }))
    );

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  let summary: string;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const firstBlock = response.content[0];
    summary = firstBlock && firstBlock.type === 'text' ? firstBlock.text.trim() : '';
  } catch (e) {
    return NextResponse.json(
      { error: 'Digest generation failed: ' + (e instanceof Error ? e.message : 'unknown error') },
      { status: 502 }
    );
  }
  if (!summary) {
    return NextResponse.json({ error: 'The model returned an empty digest' }, { status: 502 });
  }

  /* Store the digest --------------------------------------------------------------- */
  let digestId: string;
  try {
    const r = await q(
      'INSERT INTO shift_digests (business_id, period_start, period_end, summary, source_entry_ids) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [
        businessId,
        periodStart,
        periodEnd,
        summary,
        entries.map((entry) => entry.id),
      ]
    );
    digestId = r.rows[0].id as string;
  } catch {
    return NextResponse.json({ error: 'Could not store the digest' }, { status: 500 });
  }

  return NextResponse.json({
    digest: { id: digestId, summary },
    period_start: periodStart,
    period_end: periodEnd,
    schedule,
  });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const isWorker = cronSecret !== '' && authHeader === 'Bearer ' + cronSecret;

  if (isWorker) {
    // Worker path: business_id is required; RLS is bypassed via the owner pool.
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
    }
    if (typeof body.business_id !== 'string' || body.business_id === '') {
      return NextResponse.json(
        { error: 'business_id is required for the worker path' },
        { status: 400 }
      );
    }
    return runDigest(ownerQ, body.business_id);
  }

  const session = await getSessionUser();
  if (
    !session ||
    (session.profile.role !== 'admin' && session.profile.role !== 'manager')
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return withUser(session.profile.id, (q) => runDigest(q, session.business.id));
}
