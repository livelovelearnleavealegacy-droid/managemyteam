'use server';

/**
 * managemyteam.io — task board server actions (push + complete + photo URL).
 *
 * Authorization note: the DB policies on task_instance_state / task_completions
 * enforce tenancy only; the APP enforces assignment visibility here — staff
 * may act only on instances assigned to them (their user row or one of their
 * teams). Managers may act on any instance in the business.
 *
 * Railway port: Supabase query builder → pg via withUser. Photo display no
 * longer mints signed URLs (photos are served by the authenticated
 * /api/photos route); getPhotoSignedUrl keeps its name/signature for the
 * client and now returns that route URL.
 */
import { revalidatePath } from 'next/cache';
import { withUser, type QueryFn } from '@/lib/db';
import { getSessionUser, type Session } from '@/lib/auth';
import { todayLocal } from '@/lib/format';
import {
  effectiveDate,
  resolveMaxPushes,
  tryPush,
  computeStatus,
} from '@/lib/delinquency';

export interface ActionResult {
  ok: boolean;
  message: string;
}

interface ActingTemplate {
  id: string;
  title: string;
  assignment_type: string;
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  require_photo: boolean;
  max_pushes: number | null;
  checklist: { label: string }[];
}

async function actingAs(session: Session) {
  if (!session) throw new Error('Not signed in.');
  const isManager =
    session.profile.role === 'admin' || session.profile.role === 'manager';
  return { isManager };
}

/** Staff may act only on instances assigned to them; managers on all. */
async function assertCanAct(
  q: QueryFn,
  session: Session,
  template: ActingTemplate
): Promise<void> {
  const { isManager } = await actingAs(session);
  if (isManager) return;
  if (
    template.assignment_type === 'user' &&
    template.assigned_user_id === session.profile.id
  ) {
    return;
  }
  if (
    template.assignment_type === 'team' &&
    template.assigned_team_id
  ) {
    const { rows: memberships } = await q(
      'select team_id from team_members where user_id = $1',
      [session.profile.id]
    );
    if (
      memberships.some((m) => m.team_id === template.assigned_team_id)
    ) {
      return;
    }
  }
  throw new Error('You are not assigned to this task.');
}

async function loadTemplate(
  q: QueryFn,
  businessId: string,
  templateId: string
): Promise<ActingTemplate> {
  const { rows } = await q(
    'select id, title, assignment_type, assigned_user_id, assigned_team_id, require_photo, max_pushes, checklist from task_templates where business_id = $1 and id = $2 limit 1',
    [businessId, templateId]
  );
  const data = rows[0] as ActingTemplate | undefined;
  if (!data) throw new Error('Task template not found.');
  return data;
}

/**
 * Push an instance to tomorrow. Refuses with "Push limit reached" exactly at
 * the limit. When the push exhausts pushes and the instance is now
 * delinquent, an auto shift-log entry is recorded (staff are allowed to
 * INSERT auto:* shift entries; only managers can read them).
 */
export async function pushInstance(
  templateId: string,
  instanceKey: string,
  originalDate: string
): Promise<ActionResult> {
  try {
    const session = await getSessionUser();
    if (!session) return { ok: false, message: 'Not signed in.' };

    return await withUser(session.profile.id, async (q) => {
      const template = await loadTemplate(
        q,
        session.profile.business_id,
        templateId
      );
      await assertCanAct(q, session, template);

      const { rows: stateRows } = await q(
        'select push_count from task_instance_state where template_id = $1 and instance_key = $2 limit 1',
        [templateId, instanceKey]
      );
      const pushCount = (stateRows[0]?.push_count as number | undefined) ?? 0;
      const maxPushes = resolveMaxPushes(
        template.max_pushes,
        session.business.default_max_pushes
      );

      // Refuse completing a finished instance's push? No — a completed
      // instance keeps its last state; pushing a completed instance is blocked.
      const { rows: completionRows } = await q(
        'select id from task_completions where template_id = $1 and instance_key = $2 limit 1',
        [templateId, instanceKey]
      );
      if (completionRows[0]) {
        return { ok: false, message: 'This task is already completed.' };
      }

      const next = tryPush(pushCount, maxPushes);
      if (next === null) {
        return { ok: false, message: 'Push limit reached' };
      }

      const newEffective = effectiveDate(originalDate, next);
      await q(
        `insert into task_instance_state
           (business_id, template_id, instance_key, original_date, push_count, effective_date)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (template_id, instance_key) do update set
           business_id = excluded.business_id,
           original_date = excluded.original_date,
           push_count = excluded.push_count,
           effective_date = excluded.effective_date`,
        [
          session.profile.business_id,
          templateId,
          instanceKey,
          originalDate,
          next,
          newEffective,
        ]
      );

      // Delinquency flip on this exact push → auto shift-log entry.
      const status = computeStatus(
        {
          originalDate,
          pushCount: next,
          maxPushes,
          completed: false,
        },
        todayLocal()
      );
      if (status === 'delinquent') {
        await q(
          `insert into shift_entries
             (business_id, user_id, shift_date, source, body, linked)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            session.profile.business_id,
            session.profile.id,
            todayLocal(),
            'auto:task_delinquent',
            `Task delinquent: ${template.title} (was due ${newEffective})`,
            JSON.stringify({
              entity: 'task_instance',
              template_id: templateId,
              instance_key: instanceKey,
            }),
          ]
        );
      }

      revalidatePath('/tasks');
      return {
        ok: true,
        message:
          status === 'delinquent'
            ? `Pushed to ${newEffective} — push limit reached, now delinquent.`
            : `Pushed to ${newEffective}.`,
      };
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Push failed.',
    };
  }
}

export interface CompletionChecklistItem {
  label: string;
  checked: boolean;
}

/**
 * Complete an instance. All checklist items must be checked; photo is
 * required when the template requires one. Delinquent instances remain
 * completable (red-flagged but completable) — status never blocks this.
 */
export async function completeInstance(args: {
  templateId: string;
  instanceKey: string;
  checklistState: CompletionChecklistItem[];
  photoPath: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSessionUser();
    if (!session) return { ok: false, message: 'Not signed in.' };

    return await withUser(session.profile.id, async (q) => {
      const template = await loadTemplate(
        q,
        session.profile.business_id,
        args.templateId
      );
      await assertCanAct(q, session, template);

      const { rows: existingRows } = await q(
        'select id from task_completions where template_id = $1 and instance_key = $2 limit 1',
        [args.templateId, args.instanceKey]
      );
      if (existingRows[0]) {
        return { ok: false, message: 'This task is already completed.' };
      }

      const templateChecklist = (template.checklist ?? []) as {
        label: string;
      }[];
      if (templateChecklist.length > 0) {
        if (args.checklistState.length !== templateChecklist.length) {
          return { ok: false, message: 'Checklist is incomplete.' };
        }
        const allChecked = args.checklistState.every(
          (c, i) =>
            c.label === templateChecklist[i].label && c.checked === true
        );
        if (!allChecked) {
          return {
            ok: false,
            message: 'All checklist items must be checked to complete.',
          };
        }
      }
      if (template.require_photo && !args.photoPath) {
        return { ok: false, message: 'A photo is required to complete this task.' };
      }

      await q(
        `insert into task_completions
           (business_id, template_id, instance_key, completed_by, checklist_state, photo_url)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          session.profile.business_id,
          args.templateId,
          args.instanceKey,
          session.profile.id,
          JSON.stringify(args.checklistState),
          args.photoPath,
        ]
      );

      revalidatePath('/tasks');
      return { ok: true, message: 'Task completed.' };
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Completion failed.',
    };
  }
}

/**
 * Display-time URL for a stored task photo. Railway port: photos are served
 * by the authenticated /api/photos route (session cookie checked per
 * request), so no signed URL is minted — this returns that route URL. The
 * business prefix is still validated here (defense in depth).
 */
export async function getPhotoSignedUrl(path: string): Promise<string> {
  const session = await getSessionUser();
  if (!session) throw new Error('Not signed in.');
  const prefix = `${session.profile.business_id}/`;
  if (!path.startsWith(prefix)) throw new Error('Photo not found.');
  return `/api/photos/${path}`;
}
