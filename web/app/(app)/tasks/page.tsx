/**
 * managemyteam.io — task instance board.
 *
 * Staff see instances assigned to them (their user row, or teams they belong
 * to). Managers see every instance plus staff/template filters.
 *
 * Instances are expanded from templates over a window of past 14 days →
 * next 60 days, merged with task_instance_state (pushes) and
 * task_completions (done-ness), and each instance's status is computed with
 * the delinquency engine. Assignment is resolved against CURRENT team
 * membership: if someone leaves a team, that team's instances leave their
 * board.
 *
 * Railway port: the seven parallel Supabase reads became sequential pg
 * queries inside one withUser transaction (a single pg client cannot run
 * queries concurrently).
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal } from '@/lib/format';
import {
  computeStatus,
  effectiveDate,
  resolveMaxPushes,
  type Recurrence,
} from '@/lib/delinquency';
import { expandInstances } from '@/lib/recurrence';
import BoardClient from '@/components/tasks/BoardClient';
import type { BoardData, BoardInstance } from '@/components/tasks/types';

const WINDOW_BACK_DAYS = 14;
const WINDOW_FWD_DAYS = 60;

function shiftISO(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default async function TasksPage() {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  const isManager =
    session.profile.role === 'admin' || session.profile.role === 'manager';
  const businessId = session.profile.business_id;
  const today = todayLocal();
  const fromISO = shiftISO(today, -WINDOW_BACK_DAYS);
  const toISO = shiftISO(today, WINDOW_FWD_DAYS);

  const { templates, states, completions, users, teams, memberships, categories } =
    await withUser(session.profile.id, async (q) => {
      const templates = (
        await q(
          'select id, title, description, checklist, require_photo, category_id, assignment_type, assigned_user_id, assigned_team_id, recurrence, max_pushes from task_templates where business_id = $1 order by title',
          [businessId]
        )
      ).rows;
      const states = (
        await q(
          'select template_id, instance_key, original_date, push_count, effective_date from task_instance_state where business_id = $1',
          [businessId]
        )
      ).rows;
      const completions = (
        await q(
          'select template_id, instance_key, completed_by, photo_url from task_completions where business_id = $1',
          [businessId]
        )
      ).rows;
      const users = (
        await q(
          'select id, name from users where business_id = $1 and terminated_at is null',
          [businessId]
        )
      ).rows;
      const teams = (
        await q('select id, name from teams where business_id = $1', [businessId])
      ).rows;
      const memberships = (
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
      return {
        templates,
        states,
        completions,
        users,
        teams,
        memberships,
        categories,
      };
    });

  const userName = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));
  const teamName = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
  const categoryName = new Map(
    (categories ?? []).map((c) => [c.id as string, c.name as string])
  );
  // team_id → member user ids (current membership).
  const teamToUsers = new Map<string, string[]>();
  for (const m of memberships ?? []) {
    const tid = m.team_id as string;
    const arr = teamToUsers.get(tid) ?? [];
    arr.push(m.user_id as string);
    teamToUsers.set(tid, arr);
  }
  const myTeamIds = new Set(
    (memberships ?? [])
      .filter((m) => (m.user_id as string) === session.profile.id)
      .map((m) => m.team_id as string)
  );

  // instance_key already embeds the template id (`${templateId}_${date}`).
  const stateByKey = new Map(
    (states ?? []).map((s) => [s.instance_key as string, s])
  );
  const completionByKey = new Map(
    (completions ?? []).map((c) => [c.instance_key as string, c])
  );

  const instances: BoardInstance[] = [];
  for (const t of templates ?? []) {
    const templateId = t.id as string;
    const recurrence = t.recurrence as Recurrence;
    const expanded = expandInstances({ id: templateId, recurrence }, fromISO, toISO);
    const maxPushes = resolveMaxPushes(
      (t.max_pushes as number | null) ?? null,
      session.business.default_max_pushes
    );

    // Resolve assignment against CURRENT membership.
    let assigneeNames: string[] = [];
    if (t.assignment_type === 'user' && t.assigned_user_id) {
      const n = userName.get(t.assigned_user_id as string);
      assigneeNames = n ? [n] : ['(removed user)'];
    } else if (t.assignment_type === 'team' && t.assigned_team_id) {
      const tid = t.assigned_team_id as string;
      assigneeNames = (teamToUsers.get(tid) ?? [])
        .map((uid) => userName.get(uid) ?? '(removed user)')
        .sort((a, b) => a.localeCompare(b));
    }

    for (const inst of expanded) {
      const state = stateByKey.get(inst.instanceKey);
      const completion = completionByKey.get(inst.instanceKey);
      const pushCount = (state?.push_count as number | undefined) ?? 0;
      // Single source of truth for the due date: original + pushes
      // (recomputed, not trusted from the stored column).
      const effISO = effectiveDate(inst.originalDate, pushCount);

      const completed = !!completion;
      const status = computeStatus(
        {
          originalDate: inst.originalDate,
          pushCount,
          maxPushes,
          completed,
        },
        today
      );

      instances.push({
        templateId,
        instanceKey: inst.instanceKey,
        originalDate: inst.originalDate,
        effectiveDate: effISO,
        pushCount,
        maxPushes,
        status,
        completed,
        completedByName: completion
          ? (userName.get(completion.completed_by as string) ?? null)
          : null,
        photoPath: (completion?.photo_url as string | null) ?? null,
        title: t.title as string,
        description: (t.description as string) ?? '',
        categoryName: t.category_id
          ? (categoryName.get(t.category_id as string) ?? null)
          : null,
        requirePhoto: !!t.require_photo,
        checklist: ((t.checklist as { label: string }[] | null) ?? []).map(
          (c) => ({ label: c.label })
        ),
        assigneeNames,
        assignedUserId: (t.assigned_user_id as string | null) ?? null,
        assignedTeamId: (t.assigned_team_id as string | null) ?? null,
        assignedTeamName:
          t.assignment_type === 'team' && t.assigned_team_id
            ? (teamName.get(t.assigned_team_id as string) ?? null)
            : null,
      });
    }
  }

  // Staff see only their own instances.
  const visible = isManager
    ? instances
    : instances.filter(
        (i) =>
          i.assignedUserId === session.profile.id ||
          (i.assignedTeamId !== null && myTeamIds.has(i.assignedTeamId))
      );

  // Sort: effective date, then title. Completed sink to the bottom within a day.
  visible.sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate)
      return a.effectiveDate.localeCompare(b.effectiveDate);
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.title.localeCompare(b.title);
  });

  const data: BoardData = {
    instances: visible,
    isManager,
    businessId,
    staffOptions: (users ?? [])
      .map((u) => ({ id: u.id as string, name: u.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    teamMembership: (memberships ?? []).map((m) => ({
      userId: m.user_id as string,
      teamId: m.team_id as string,
    })),
    templateOptions: (templates ?? [])
      .map((t) => ({ id: t.id as string, title: t.title as string }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    businessDefaultMaxPushes: session.business.default_max_pushes,
    today,
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <h1 className="page-title">Tasks</h1>
        {isManager && (
          <a href="/tasks/templates" className="btn btn-ghost">
            Task templates
          </a>
        )}
      </div>
      <p style={{ color: 'var(--text2)', margin: '8px 0 20px' }}>
        {isManager
          ? 'Every instance across the business. Pushing a task moves it to tomorrow — pushes are capped, then it goes delinquent.'
          : 'Your tasks. Pushing moves a task to tomorrow — pushes are capped, then it goes delinquent.'}
      </p>
      <BoardClient data={data} />
    </div>
  );
}
