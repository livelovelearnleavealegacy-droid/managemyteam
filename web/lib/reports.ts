import {
  computeStatus,
  resolveMaxPushes,
  type Recurrence,
  type TaskStatus,
} from '@/lib/delinquency';
import { expandInstances } from '@/lib/recurrence';
import { fmtDate } from '@/lib/format';
import type { QueryFn } from '@/lib/db';

/**
 * Shared report computation used by the reports page and the
 * /api/reports/email route so both render the identical summary.
 *
 * Railway port: fetchInstanceRows takes a pg QueryFn (from withUser) instead
 * of the Supabase query builder. Callers: `await withUser(session.profile.id,
 * (q) => fetchInstanceRows(q, session.business.id, ...))`.
 */

export type RangeKey = 'today' | 'week' | 'month';

export interface StaffLite {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface InstanceRow {
  templateId: string;
  title: string;
  categoryId: string | null;
  categoryName: string;
  instanceKey: string;
  originalDate: string;
  effectiveDate: string;
  pushCount: number;
  maxPushes: number;
  completed: boolean;
  status: TaskStatus;
  assigneeIds: string[];
  assigneeNames: string;
}

/* Date helpers ------------------------------------------------------------- */

function noon(iso: string): Date {
  // Bare YYYY-MM-DD parses at noon local to avoid timezone-day shifts.
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(iso)) {
    return new Date(iso + 'T12:00:00');
  }
  return new Date(iso);
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function addDaysISO(iso: string, n: number): string {
  const d = noon(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/** Anchored ranges: today / this week (Mon-Sun) / this month. */
export function rangeBounds(
  range: RangeKey,
  todayISO: string
): { from: string; to: string } {
  if (range === 'today') return { from: todayISO, to: todayISO };
  if (range === 'month') {
    const from = todayISO.slice(0, 7) + '-01';
    const first = noon(from);
    const lastDay = new Date(
      first.getFullYear(),
      first.getMonth() + 1,
      0
    ).getDate();
    return {
      from,
      to: todayISO.slice(0, 7) + '-' + String(lastDay).padStart(2, '0'),
    };
  }
  const mondayOffset = (noon(todayISO).getDay() + 6) % 7;
  const from = addDaysISO(todayISO, -mondayOffset);
  return { from, to: addDaysISO(from, 6) };
}

export function rangeTitle(range: RangeKey): string {
  if (range === 'today') return 'Today';
  if (range === 'week') return 'This week (Mon-Sun)';
  return 'This month';
}

/* Instance computation ------------------------------------------------------ */

export async function fetchInstanceRows(
  q: QueryFn,
  businessId: string,
  defaultMaxPushes: number,
  from: string,
  to: string,
  todayISO: string
): Promise<{ staff: StaffLite[]; instances: InstanceRow[] }> {
  // Queried sequentially: a single pg client cannot run queries concurrently.
  const users = (
    await q(
      'select id, name, email, role, terminated_at from users where business_id = $1 order by name',
      [businessId]
    )
  ).rows;
  const members = (
    await q(
      'select team_id, user_id from team_members where business_id = $1',
      [businessId]
    )
  ).rows;
  const categories = (
    await q('select id, name from categories where business_id = $1', [
      businessId,
    ])
  ).rows;
  const templates = (
    await q(
      'select id, title, category_id, assignment_type, assigned_user_id, assigned_team_id, recurrence, max_pushes from task_templates where business_id = $1',
      [businessId]
    )
  ).rows;
  const states = (
    await q(
      'select instance_key, push_count, effective_date from task_instance_state where business_id = $1',
      [businessId]
    )
  ).rows;
  const completions = (
    await q(
      'select instance_key from task_completions where business_id = $1',
      [businessId]
    )
  ).rows;

  // terminated_at is timestamptz: pg hands back a Date, not a string.
  const userList = (users as any[]).map((u) => ({
    id: u.id as string,
    name: u.name as string,
    email: u.email as string,
    role: u.role as string,
    terminated_at: (u.terminated_at as Date | null) ?? null,
  }));
  const staff: StaffLite[] = userList
    .filter((u) => !u.terminated_at)
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
  const nameById: Record<string, string> = {};
  userList.forEach((u) => {
    nameById[u.id] = u.name;
  });

  const teamToUsers: Record<string, string[]> = {};
  (members as any[]).forEach((m) => {
    const list = teamToUsers[m.team_id as string] ?? [];
    list.push(m.user_id as string);
    teamToUsers[m.team_id as string] = list;
  });

  const catById: Record<string, string> = {};
  (categories as any[]).forEach((c) => {
    catById[c.id as string] = c.name as string;
  });

  const stateByKey: Record<string, { push_count: number; effective_date: string }> =
    {};
  (states as any[]).forEach((s) => {
    stateByKey[s.instance_key as string] = {
      push_count: Number(s.push_count),
      effective_date: s.effective_date as string,
    };
  });
  const completedKeys = new Set(
    (completions as any[]).map((c) => c.instance_key as string)
  );

  const instances: InstanceRow[] = [];
  for (const t of templates as any[]) {
    const recurrence = t.recurrence as Recurrence;
    const expanded = expandInstances(
      { id: t.id as string, recurrence },
      from,
      to
    );
    const maxPushes = resolveMaxPushes(
      (t.max_pushes as number | null) ?? null,
      defaultMaxPushes
    );
    let assigneeIds: string[] = [];
    if (t.assignment_type === 'user' && t.assigned_user_id) {
      assigneeIds = [t.assigned_user_id as string];
    } else if (t.assignment_type === 'team' && t.assigned_team_id) {
      assigneeIds = teamToUsers[t.assigned_team_id as string] ?? [];
    }
    const assigneeNames =
      assigneeIds.map((id) => nameById[id] ?? 'Unknown').join(', ') ||
      'Unassigned';
    for (const inst of expanded) {
      const st = stateByKey[inst.instanceKey];
      const pushCount = st ? st.push_count : 0;
      const completed = completedKeys.has(inst.instanceKey);
      const status = computeStatus(
        { originalDate: inst.originalDate, pushCount, maxPushes, completed },
        todayISO
      );
      instances.push({
        templateId: t.id as string,
        title: t.title as string,
        categoryId: (t.category_id as string | null) ?? null,
        categoryName:
          (t.category_id && catById[t.category_id as string]) || 'Uncategorized',
        instanceKey: inst.instanceKey,
        originalDate: inst.originalDate,
        effectiveDate: st ? st.effective_date : inst.originalDate,
        pushCount,
        maxPushes,
        completed,
        status,
        assigneeIds,
        assigneeNames,
      });
    }
  }
  instances.sort((a, b) =>
    a.originalDate < b.originalDate
      ? -1
      : a.originalDate > b.originalDate
        ? 1
        : 0
  );
  return { staff, instances };
}

/* Aggregates ---------------------------------------------------------------- */

export interface PerStaffRow {
  id: string;
  name: string;
  instances: number;
  completed: number;
  pushed: number;
  delinquent: number;
  overdue: number;
  dueToday: number;
}

export interface PerCategoryRow {
  name: string;
  instances: number;
  completed: number;
  pushed: number;
  delinquent: number;
}

export interface ReportAggregates {
  totals: {
    instances: number;
    completed: number;
    pushed: number;
    delinquent: number;
    overdue: number;
    dueToday: number;
  };
  perStaff: PerStaffRow[];
  perCategory: PerCategoryRow[];
  delinquents: InstanceRow[];
}

export function computeAggregates(
  staff: StaffLite[],
  instances: InstanceRow[]
): ReportAggregates {
  const totals = {
    instances: instances.length,
    completed: 0,
    pushed: 0,
    delinquent: 0,
    overdue: 0,
    dueToday: 0,
  };
  for (const i of instances) {
    if (i.completed) totals.completed += 1;
    if (i.pushCount > 0) totals.pushed += 1;
    if (i.status === 'delinquent') totals.delinquent += 1;
    else if (i.status === 'overdue') totals.overdue += 1;
    else if (i.status === 'due-today') totals.dueToday += 1;
  }

  const perStaff: PerStaffRow[] = staff.map((s) => {
    const mine = instances.filter((i) => i.assigneeIds.includes(s.id));
    return {
      id: s.id,
      name: s.name,
      instances: mine.length,
      completed: mine.filter((i) => i.completed).length,
      pushed: mine.filter((i) => i.pushCount > 0).length,
      delinquent: mine.filter((i) => i.status === 'delinquent').length,
      overdue: mine.filter((i) => i.status === 'overdue').length,
      dueToday: mine.filter((i) => i.status === 'due-today').length,
    };
  });
  perStaff.sort((a, b) =>
    b.delinquent !== a.delinquent
      ? b.delinquent - a.delinquent
      : a.name.localeCompare(b.name)
  );

  const byCat = new Map<string, PerCategoryRow>();
  for (const i of instances) {
    const row = byCat.get(i.categoryName) ?? {
      name: i.categoryName,
      instances: 0,
      completed: 0,
      pushed: 0,
      delinquent: 0,
    };
    row.instances += 1;
    if (i.completed) row.completed += 1;
    if (i.pushCount > 0) row.pushed += 1;
    if (i.status === 'delinquent') row.delinquent += 1;
    byCat.set(i.categoryName, row);
  }
  const perCategory = Array.from(byCat.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const delinquents = instances
    .filter((i) => i.status === 'delinquent')
    .sort((a, b) =>
      a.originalDate < b.originalDate
        ? -1
        : a.originalDate > b.originalDate
          ? 1
          : a.title.localeCompare(b.title)
    );

  return { totals, perStaff, perCategory, delinquents };
}

/* Email HTML ---------------------------------------------------------------- */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildReportHtml(args: {
  businessName: string;
  rangeTitle: string;
  from: string;
  to: string;
  staff: StaffLite[];
  instances: InstanceRow[];
}): string {
  const agg = computeAggregates(args.staff, args.instances);
  const t = agg.totals;
  const staffRows = agg.perStaff
    .map(
      (r) =>
        '<tr><td>' +
        esc(r.name) +
        '</td><td>' +
        r.instances +
        '</td><td>' +
        r.completed +
        '</td><td>' +
        r.pushed +
        '</td><td>' +
        r.delinquent +
        '</td></tr>'
    )
    .join('');
  const catRows = agg.perCategory
    .map(
      (r) =>
        '<tr><td>' +
        esc(r.name) +
        '</td><td>' +
        r.instances +
        '</td><td>' +
        r.completed +
        '</td><td>' +
        r.pushed +
        '</td><td>' +
        r.delinquent +
        '</td></tr>'
    )
    .join('');
  const delRows =
    agg.delinquents.length === 0
      ? '<tr><td colspan="4">None. Nice work.</td></tr>'
      : agg.delinquents
          .map(
            (d) =>
              '<tr><td>' +
              esc(d.title) +
              '</td><td>' +
              esc(fmtDate(d.originalDate)) +
              '</td><td>' +
              esc(d.assigneeNames) +
              '</td><td>' +
              d.pushCount +
              ' of ' +
              d.maxPushes +
              '</td></tr>'
          )
          .join('');

  return (
    '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e2a22;max-width:720px;margin:0 auto;padding:24px;">' +
    '<h1 style="font-size:22px;margin:0 0 4px;">' +
    esc(args.businessName) +
    ' — Task report</h1>' +
    '<p style="color:#5a6b60;margin:0 0 20px;">' +
    esc(args.rangeTitle) +
    ' · ' +
    esc(fmtDate(args.from)) +
    ' – ' +
    esc(fmtDate(args.to)) +
    '</p>' +
    '<h2 style="font-size:16px;">Totals</h2>' +
    '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;">' +
    '<tr><th align="left">Instances</th><th align="left">Completed</th><th align="left">Pushed</th><th align="left">Delinquent</th></tr>' +
    '<tr><td>' +
    t.instances +
    '</td><td>' +
    t.completed +
    '</td><td>' +
    t.pushed +
    '</td><td>' +
    t.delinquent +
    '</td></tr></table>' +
    '<h2 style="font-size:16px;margin-top:24px;">Per staff</h2>' +
    '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;">' +
    '<tr><th align="left">Name</th><th align="left">Instances</th><th align="left">Completed</th><th align="left">Pushed</th><th align="left">Delinquent</th></tr>' +
    staffRows +
    '</table>' +
    '<h2 style="font-size:16px;margin-top:24px;">Per category</h2>' +
    '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;">' +
    '<tr><th align="left">Category</th><th align="left">Instances</th><th align="left">Completed</th><th align="left">Pushed</th><th align="left">Delinquent</th></tr>' +
    catRows +
    '</table>' +
    '<h2 style="font-size:16px;margin-top:24px;">Delinquency detail</h2>' +
    '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;">' +
    '<tr><th align="left">Task</th><th align="left">Due</th><th align="left">Assignee</th><th align="left">Pushes used</th></tr>' +
    delRows +
    '</table>' +
    '<p style="color:#5a6b60;font-size:12px;margin-top:24px;">Sent by managemyteam.io</p>' +
    '</body></html>'
  );
}
