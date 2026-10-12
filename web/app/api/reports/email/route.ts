import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db, withUser, type QueryFn } from '@/lib/db';
import { todayLocal } from '@/lib/format';
import { sendEmail } from '@/lib/email';
import {
  buildReportHtml,
  fetchInstanceRows,
  rangeBounds,
  rangeTitle,
  type InstanceRow,
  type RangeKey,
  type StaffLite,
} from '@/lib/reports';

/**
 * POST /api/reports/email
 *
 * Two callers:
 *  1. The reports page form (signed-in manager, form-encoded body).
 *  2. A scheduled worker (no session) with
 *     Authorization: Bearer <CRON_SECRET> and JSON { business_id, to?, range? }.
 *     business_id is required; `to` defaults to every admin's email.
 *
 * Railway port: the manager path reads through the RLS-scoped withUser
 * transaction; the worker path uses the owner pool (`db`) since there is no
 * session. Email goes through Resend (lib/email) exactly as before.
 */

/** Owner-pool query shaped as a QueryFn for the worker path. */
const ownerQ: QueryFn = async (text, params) => {
  const r = await db.query(text, params);
  return { rows: r.rows, rowCount: r.rowCount ?? 0 };
};

function isRange(v: unknown): v is RangeKey {
  return v === 'today' || v === 'week' || v === 'month';
}

function splitEmails(to: unknown): string[] {
  const raw: string[] =
    typeof to === 'string'
      ? to.split(',')
      : Array.isArray(to)
        ? to.filter((x): x is string => typeof x === 'string')
        : [];
  return Array.from(
    new Set(
      raw
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.indexOf('@') > 0)
    )
  );
}

async function deliver(
  req: NextRequest,
  args: {
    range: RangeKey;
    wantsJson: boolean;
    businessName: string;
    recipients: string[];
    staff: StaffLite[];
    instances: InstanceRow[];
  }
): Promise<NextResponse> {
  const today = todayLocal();
  const { from, to } = rangeBounds(args.range, today);
  const html = buildReportHtml({
    businessName: args.businessName,
    rangeTitle: rangeTitle(args.range),
    from,
    to,
    staff: args.staff,
    instances: args.instances,
  });
  const subject = args.businessName + ' — ' + rangeTitle(args.range) + ' report';

  let sentAny = false;
  let skippedAll = true;
  for (const to of args.recipients) {
    const res = await sendEmail({ to, subject, html });
    if (res.sent) sentAny = true;
    if (!res.skipped) skippedAll = false;
  }
  const result = { sent: sentAny, skipped: skippedAll };

  if (args.wantsJson) return NextResponse.json(result);
  const mailed = sentAny ? 'sent' : skippedAll ? 'skipped' : 'failed';
  return NextResponse.redirect(
    new URL('/reports?range=' + args.range + '&mailed=' + mailed, req.url),
    303
  );
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';
  const wantsJson = contentType.indexOf('application/json') >= 0;

  let range: RangeKey = 'week';
  let toRaw: unknown;
  let cronBusinessId: string | undefined;

  if (wantsJson) {
    const body = (await req.json()) as Record<string, unknown>;
    if (isRange(body.range)) range = body.range;
    toRaw = body.to;
    if (typeof body.business_id === 'string') cronBusinessId = body.business_id;
  } else {
    const form = await req.formData();
    if (isRange(form.get('range'))) range = form.get('range') as RangeKey;
    const t = form.get('to');
    if (typeof t === 'string') toRaw = t;
  }

  const session = await getSessionUser();
  const isManager =
    !!session &&
    (session.profile.role === 'admin' || session.profile.role === 'manager');

  const today = todayLocal();
  const { from, to } = rangeBounds(range, today);

  if (isManager && session) {
    const businessId = session.business.id;
    let recipients = splitEmails(toRaw);
    if (recipients.length === 0) recipients = [session.profile.email];

    const { staff, instances } = await withUser(session.profile.id, (q) =>
      fetchInstanceRows(
        q,
        businessId,
        session.business.default_max_pushes,
        from,
        to,
        today
      )
    );
    return deliver(req, {
      range,
      wantsJson,
      businessName: session.business.name,
      recipients,
      staff,
      instances,
    });
  }

  // Worker path: bearer token, no session — owner pool (bypasses RLS).
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization') ?? '';
  if (!secret || authz !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!cronBusinessId) {
    return NextResponse.json(
      { error: 'business_id is required' },
      { status: 400 }
    );
  }
  const biz = (
    await db.query(
      'SELECT id, name, default_max_pushes FROM businesses WHERE id = $1 LIMIT 1',
      [cronBusinessId]
    )
  ).rows[0] as
    | { id: string; name: string; default_max_pushes: number }
    | undefined;
  if (!biz) {
    return NextResponse.json({ error: 'Unknown business_id' }, { status: 404 });
  }
  let recipients = splitEmails(toRaw);
  if (recipients.length === 0) {
    const admins = await db.query(
      "SELECT email FROM users WHERE business_id = $1 AND role = 'admin' AND terminated_at IS NULL",
      [biz.id]
    );
    recipients = admins.rows
      .map((a) => a.email as string)
      .filter((e) => typeof e === 'string' && e.length > 0);
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients' }, { status: 400 });
  }

  const { staff, instances } = await fetchInstanceRows(
    ownerQ,
    biz.id,
    biz.default_max_pushes,
    from,
    to,
    today
  );
  return deliver(req, {
    range,
    wantsJson,
    businessName: biz.name,
    recipients,
    staff,
    instances,
  });
}
