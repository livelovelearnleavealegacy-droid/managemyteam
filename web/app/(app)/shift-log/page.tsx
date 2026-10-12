import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal } from '@/lib/format';
import { runEscalationSweep } from './actions';
import Composer from '@/components/shift-log/Composer';
import ActionItems from '@/components/shift-log/ActionItems';
import EntryList from '@/components/shift-log/EntryList';
import DigestList from '@/components/shift-log/DigestList';
import {
  addDays,
  diffDays,
  truncate,
  type ActionItemView,
  type EntryGroup,
  type EntryOption,
  type ShiftActionItem,
  type ShiftDigest,
  type ShiftEntry,
} from '@/components/shift-log/types';

export const dynamic = 'force-dynamic';

/** pg returns date columns as Date; the UI contract is YYYY-MM-DD strings. */
function toDay(value: unknown): string {
  return new Date(value as string | Date).toISOString().slice(0, 10);
}

/** pg returns timestamptz columns as Date; the UI contract is ISO strings. */
function toISO(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

function toActionItem(row: Record<string, unknown>): ShiftActionItem {
  return {
    id: row.id as string,
    business_id: row.business_id as string,
    shift_entry_id: (row.shift_entry_id as string | null) ?? null,
    title: row.title as string,
    due_date: toDay(row.due_date),
    escalation_days: Number(row.escalation_days),
    status: row.status as 'open' | 'done',
    done_at: row.done_at ? toISO(row.done_at) : null,
    escalated: Boolean(row.escalated),
    escalated_at: row.escalated_at ? toISO(row.escalated_at) : null,
    flagged_next: Boolean(row.flagged_next),
    created_by: (row.created_by as string | null) ?? null,
    created_at: toISO(row.created_at),
  };
}

function toDigest(row: Record<string, unknown>): ShiftDigest {
  return {
    id: row.id as string,
    business_id: row.business_id as string,
    period_start: toDay(row.period_start),
    period_end: toDay(row.period_end),
    summary: row.summary as string,
    source_entry_ids: (row.source_entry_ids as string[]) ?? [],
    created_at: toISO(row.created_at),
  };
}

export default async function ShiftLogPage() {
  const session = await requireManager();
  const businessId = session.business.id;

  // Escalation sweep runs on every page load (idempotent).
  await runEscalationSweep();

  const today = todayLocal();

  const { entryRows, openRows, doneRows, digestRows } = await withUser(
    session.profile.id,
    async (q) => {
      // Queried sequentially: a single pg client cannot run queries concurrently.
      const e = await q(
        'SELECT e.id, e.business_id, e.user_id, e.shift_date, e.body, e.source, e.linked, e.created_at, u.name AS author_name ' +
          'FROM shift_entries e LEFT JOIN users u ON u.id = e.user_id ' +
          'WHERE e.business_id = $1 ' +
          'ORDER BY e.shift_date DESC, e.created_at DESC LIMIT 200',
        [businessId]
      );
      const o = await q(
        "SELECT * FROM shift_action_items WHERE business_id = $1 AND status = 'open' ORDER BY due_date ASC",
        [businessId]
      );
      const d = await q(
        "SELECT * FROM shift_action_items WHERE business_id = $1 AND status = 'done' ORDER BY done_at DESC LIMIT 25",
        [businessId]
      );
      const g = await q(
        'SELECT * FROM shift_digests WHERE business_id = $1 ORDER BY created_at DESC LIMIT 25',
        [businessId]
      );
      return {
        entryRows: e.rows,
        openRows: o.rows,
        doneRows: d.rows,
        digestRows: g.rows,
      };
    }
  );

  /* Log entries, newest first, with author names ------------------------------ */
  const entries: ShiftEntry[] = entryRows.map((row) => ({
    id: row.id as string,
    business_id: row.business_id as string,
    user_id: (row.user_id as string | null) ?? null,
    shift_date: toDay(row.shift_date),
    body: row.body as string,
    source: row.source as string,
    linked: (row.linked as Record<string, unknown> | null) ?? null,
    created_at: toISO(row.created_at),
    author_name: (row.author_name as string | null) ?? null,
  }));

  const byDate = new Map<string, ShiftEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.shift_date);
    if (list) {
      list.push(entry);
    } else {
      byDate.set(entry.shift_date, [entry]);
    }
  }
  const groups: EntryGroup[] = Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([shift_date, items]) => ({ shift_date, entries: items }));

  const recentEntries: EntryOption[] = entries.slice(0, 30).map((entry) => ({
    id: entry.id,
    label: truncate(entry.shift_date + ' — ' + entry.body, 60),
  }));

  /* Action items ---------------------------------------------------------------- */
  const toView = (rows: ShiftActionItem[]): ActionItemView[] =>
    rows.map((row) => ({
      ...row,
      escalation_date: addDays(row.due_date, Number(row.escalation_days)),
      days_remaining: diffDays(today, row.due_date),
    }));

  const openItems = toView(openRows.map((r) => toActionItem(r as Record<string, unknown>)));
  const doneItems = toView(doneRows.map((r) => toActionItem(r as Record<string, unknown>)));

  /* Past digests ------------------------------------------------------------------ */
  const digests = digestRows.map((r) => toDigest(r as Record<string, unknown>));

  return (
    <div>
      <h1 className="page-title">Shift log</h1>
      <p style={{ color: 'var(--text2)', marginTop: 0, marginBottom: 24 }}>
        Hand off the shift: log what happened, track what still needs doing, and review
        past digests.
      </p>

      <Composer />
      <ActionItems openItems={openItems} doneItems={doneItems} recentEntries={recentEntries} />
      <EntryList groups={groups} />
      <DigestList digests={digests} />
    </div>
  );
}
