'use server';

/**
 * managemyteam.io — task template CRUD (manager+ only).
 * Instance state/completion rows cascade on template delete via the DB FKs
 * (task_instance_state / task_completions reference task_templates with
 * ON DELETE CASCADE; RLS delete policies allow manager+).
 *
 * Railway port: Supabase query builder → pg via withUser. JSON columns
 * (checklist, recurrence) are passed as JSON strings.
 */
import { revalidatePath } from 'next/cache';
import { withUser, type QueryFn } from '@/lib/db';
import { requireManager } from '@/lib/auth';
import type { Recurrence } from '@/lib/delinquency';

export interface TemplateInput {
  title: string;
  description: string;
  checklist: { label: string }[];
  requirePhoto: boolean;
  categoryId: string | null;
  assignmentType: 'user' | 'team';
  assignedUserId: string | null;
  assignedTeamId: string | null;
  recurrence: Recurrence;
  maxPushes: number | null;
}

export interface TemplateActionResult {
  ok: boolean;
  message: string;
}

function validateInput(input: TemplateInput): string | null {
  if (!input.title.trim()) return 'A title is required.';
  if (input.assignmentType !== 'user' && input.assignmentType !== 'team') {
    return 'Choose an assignment: a specific user or a whole team.';
  }
  if (input.assignmentType === 'user' && !input.assignedUserId) {
    return 'Choose the user this task is assigned to.';
  }
  if (input.assignmentType === 'team' && !input.assignedTeamId) {
    return 'Choose the team this task is assigned to.';
  }
  for (const c of input.checklist) {
    if (!c.label.trim()) return 'Checklist items cannot be blank.';
  }
  const r = input.recurrence;
  if (r.kind === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return 'Pick a date for the one-time task.';
  } else if (r.kind === 'weekly') {
    const days = (r.weekdays ?? []).filter(
      (w) => Number.isInteger(w) && w >= 0 && w <= 6
    );
    if (days.length === 0) return 'Pick at least one weekday.';
  } else if (r.kind === 'monthly') {
    const days = (r.days ?? []).filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= 31
    );
    const months = (r.months ?? []).filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= 12
    );
    if (days.length === 0) return 'Pick at least one day of the month.';
    if (months.length === 0) return 'Pick at least one month.';
  }
  if (
    input.maxPushes !== null &&
    (!Number.isInteger(input.maxPushes) || input.maxPushes < 0)
  ) {
    return 'Max pushes must be a whole number of 0 or more (or empty).';
  }
  return null;
}

async function assertAssignee(
  q: QueryFn,
  businessId: string,
  input: TemplateInput
): Promise<string | null> {
  if (input.assignmentType === 'user') {
    const { rows } = await q(
      'select id from users where business_id = $1 and id = $2 limit 1',
      [businessId, input.assignedUserId]
    );
    if (!rows[0]) return 'The selected user no longer exists.';
  } else {
    const { rows } = await q(
      'select id from teams where business_id = $1 and id = $2 limit 1',
      [businessId, input.assignedTeamId]
    );
    if (!rows[0]) return 'The selected team no longer exists.';
  }
  return null;
}

function rowFromInput(businessId: string, input: TemplateInput, createdBy: string) {
  return {
    business_id: businessId,
    title: input.title.trim(),
    description: input.description.trim(),
    checklist: JSON.stringify(input.checklist.map((c) => ({ label: c.label.trim() }))),
    require_photo: input.requirePhoto,
    category_id: input.categoryId,
    assignment_type: input.assignmentType,
    assigned_user_id:
      input.assignmentType === 'user' ? input.assignedUserId : null,
    assigned_team_id:
      input.assignmentType === 'team' ? input.assignedTeamId : null,
    recurrence: JSON.stringify(input.recurrence),
    max_pushes: input.maxPushes,
    created_by: createdBy,
  };
}

export async function createTemplate(
  input: TemplateInput
): Promise<TemplateActionResult> {
  try {
    const session = await requireManager();
    const err = validateInput(input);
    if (err) return { ok: false, message: err };

    return await withUser(session.profile.id, async (q) => {
      const assigneeErr = await assertAssignee(
        q,
        session.profile.business_id,
        input
      );
      if (assigneeErr) return { ok: false, message: assigneeErr };

      const row = rowFromInput(
        session.profile.business_id,
        input,
        session.profile.id
      );
      await q(
        `insert into task_templates
           (business_id, title, description, checklist, require_photo, category_id,
            assignment_type, assigned_user_id, assigned_team_id, recurrence, max_pushes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.business_id,
          row.title,
          row.description,
          row.checklist,
          row.require_photo,
          row.category_id,
          row.assignment_type,
          row.assigned_user_id,
          row.assigned_team_id,
          row.recurrence,
          row.max_pushes,
          row.created_by,
        ]
      );

      revalidatePath('/tasks/templates');
      revalidatePath('/tasks');
      return { ok: true, message: `Template “${input.title.trim()}” created.` };
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not create the template.',
    };
  }
}

export async function updateTemplate(
  id: string,
  input: TemplateInput
): Promise<TemplateActionResult> {
  try {
    const session = await requireManager();
    const err = validateInput(input);
    if (err) return { ok: false, message: err };

    return await withUser(session.profile.id, async (q) => {
      const assigneeErr = await assertAssignee(
        q,
        session.profile.business_id,
        input
      );
      if (assigneeErr) return { ok: false, message: assigneeErr };

      const row = rowFromInput(
        session.profile.business_id,
        input,
        session.profile.id
      );
      // created_by is set-once; don't overwrite on edit.
      await q(
        `update task_templates set
           business_id = $1, title = $2, description = $3, checklist = $4,
           require_photo = $5, category_id = $6, assignment_type = $7,
           assigned_user_id = $8, assigned_team_id = $9, recurrence = $10,
           max_pushes = $11, updated_at = now()
         where business_id = $12 and id = $13`,
        [
          row.business_id,
          row.title,
          row.description,
          row.checklist,
          row.require_photo,
          row.category_id,
          row.assignment_type,
          row.assigned_user_id,
          row.assigned_team_id,
          row.recurrence,
          row.max_pushes,
          session.profile.business_id,
          id,
        ]
      );

      revalidatePath('/tasks/templates');
      revalidatePath('/tasks');
      return { ok: true, message: `Template “${input.title.trim()}” updated.` };
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not update the template.',
    };
  }
}

export async function deleteTemplate(id: string): Promise<TemplateActionResult> {
  try {
    const session = await requireManager();

    return await withUser(session.profile.id, async (q) => {
      const { rows: existingRows } = await q(
        'select id, title from task_templates where business_id = $1 and id = $2 limit 1',
        [session.profile.business_id, id]
      );
      const existing = existingRows[0] as { id: string; title: string } | undefined;
      if (!existing) return { ok: false, message: 'Template not found.' };

      await q(
        'delete from task_templates where business_id = $1 and id = $2',
        [session.profile.business_id, id]
      );

      revalidatePath('/tasks/templates');
      revalidatePath('/tasks');
      return {
        ok: true,
        message: `Template “${existing.title}” deleted (its instance history went with it).`,
      };
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not delete the template.',
    };
  }
}
