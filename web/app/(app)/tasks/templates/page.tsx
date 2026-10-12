/**
 * managemyteam.io — task templates (manager+).
 * CRUD for the recurring-task templates that feed the instance board.
 *
 * Railway port: the five parallel Supabase reads became sequential pg
 * queries inside one withUser transaction. terminated_at (timestamptz) is
 * converted to an ISO string for the client-bound TemplatesData.
 */
import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { describeRecurrence } from '@/lib/recurrence';
import type { Recurrence } from '@/lib/delinquency';
import TemplatesClient from '@/components/tasks/TemplatesClient';
import type { TemplateRow, TemplatesData } from '@/components/tasks/types';

export default async function TaskTemplatesPage() {
  const session = await requireManager();
  const businessId = session.profile.business_id;

  const { templates, categories, users, teams, memberships } = await withUser(
    session.profile.id,
    async (q) => {
      const templates = (
        await q(
          'select id, title, description, checklist, require_photo, category_id, assignment_type, assigned_user_id, assigned_team_id, recurrence, max_pushes, created_at from task_templates where business_id = $1 order by created_at desc',
          [businessId]
        )
      ).rows;
      const categories = (
        await q(
          'select id, name from categories where business_id = $1 order by name',
          [businessId]
        )
      ).rows;
      const users = (
        await q(
          'select id, name, role, terminated_at from users where business_id = $1 order by name',
          [businessId]
        )
      ).rows;
      const teams = (
        await q('select id, name from teams where business_id = $1 order by name', [
          businessId,
        ])
      ).rows;
      const memberships = (
        await q('select team_id from team_members where business_id = $1', [
          businessId,
        ])
      ).rows;
      return { templates, categories, users, teams, memberships };
    }
  );

  const userName = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));
  const teamName = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
  const categoryName = new Map(
    (categories ?? []).map((c) => [c.id as string, c.name as string])
  );
  const memberCount = new Map<string, number>();
  for (const m of memberships ?? []) {
    const tid = m.team_id as string;
    memberCount.set(tid, (memberCount.get(tid) ?? 0) + 1);
  }

  const rows: TemplateRow[] = (templates ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    description: (t.description as string) ?? '',
    checklist: ((t.checklist as { label: string }[] | null) ?? []).map((c) => ({
      label: c.label,
    })),
    requirePhoto: !!t.require_photo,
    categoryId: (t.category_id as string | null) ?? null,
    categoryName: t.category_id
      ? (categoryName.get(t.category_id as string) ?? null)
      : null,
    assignmentType: t.assignment_type as 'user' | 'team',
    assignedUserId: (t.assigned_user_id as string | null) ?? null,
    assignedUserName: t.assigned_user_id
      ? (userName.get(t.assigned_user_id as string) ?? null)
      : null,
    assignedTeamId: (t.assigned_team_id as string | null) ?? null,
    assignedTeamName: t.assigned_team_id
      ? (teamName.get(t.assigned_team_id as string) ?? null)
      : null,
    recurrence: t.recurrence as unknown,
    recurrenceLabel: describeRecurrence(t.recurrence as Recurrence),
    maxPushes: (t.max_pushes as number | null) ?? null,
  }));

  const data: TemplatesData = {
    templates: rows,
    categories: (categories ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
    })),
    users: (users ?? []).map((u) => ({
      id: u.id as string,
      name: u.name as string,
      role: u.role as string,
      terminatedAt: u.terminated_at
        ? new Date(u.terminated_at as string | Date).toISOString()
        : null,
    })),
    teams: (teams ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      memberCount: memberCount.get(t.id as string) ?? 0,
    })),
    businessDefaultMaxPushes: session.business.default_max_pushes,
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
        <h1 className="page-title">Task templates</h1>
        <a href="/tasks" className="btn btn-ghost">
          Instance board
        </a>
      </div>
      <p style={{ color: 'var(--text2)', margin: '8px 0 20px' }}>
        Templates generate the instances staff see on the board. Push limits,
        checklists, and photo requirements live here.
      </p>
      <TemplatesClient data={data} />
    </div>
  );
}
