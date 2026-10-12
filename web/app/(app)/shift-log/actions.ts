'use server';

import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal } from '@/lib/format';
import { addDays } from '@/components/shift-log/types';

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

type ActionResult = { ok: true } | { ok: false; error: string };

async function authed() {
  const session = await requireManager();
  return { session, businessId: session.business.id };
}

/* Quick-log a shift entry ---------------------------------------------------- */
export async function createShiftEntry(input: {
  body: string;
  source: 'manual' | 'voice';
}): Promise<ActionResult> {
  const { session, businessId } = await authed();
  const body = String(input.body ?? '').trim();
  if (!body) {
    return { ok: false, error: 'Write something before logging it.' };
  }
  const source = input.source === 'voice' ? 'voice' : 'manual';

  try {
    await withUser(session.profile.id, (q) =>
      q(
        'INSERT INTO shift_entries (business_id, user_id, shift_date, body, source, linked) VALUES ($1, $2, $3, $4, $5, NULL)',
        [businessId, session.profile.id, todayLocal(), body, source]
      )
    );
  } catch {
    return { ok: false, error: 'Could not save the entry. Try again.' };
  }
  revalidatePath('/shift-log');
  return { ok: true };
}

/* Create an action item ------------------------------------------------------- */
export async function createActionItem(input: {
  title: string;
  due_date: string;
  escalation_days: string;
  flagged_next: boolean;
  shift_entry_id: string;
}): Promise<ActionResult> {
  const { session, businessId } = await authed();

  const title = String(input.title ?? '').trim();
  if (!title) {
    return { ok: false, error: 'A title is required.' };
  }
  const dueDate = String(input.due_date ?? '');
  if (!DATE_RE.test(dueDate)) {
    return { ok: false, error: 'A due date is required.' };
  }
  const escalationDays = Number(String(input.escalation_days ?? '').trim());
  if (!Number.isInteger(escalationDays) || escalationDays < 0) {
    return { ok: false, error: 'Escalation days must be a whole number, 0 or more.' };
  }

  const entryId = String(input.shift_entry_id ?? '').trim();
  let shiftEntryId: string | null = null;
  if (entryId) {
    const linkedEntry = await withUser(session.profile.id, async (q) => {
      const r = await q(
        'SELECT id FROM shift_entries WHERE id = $1 AND business_id = $2 LIMIT 1',
        [entryId, businessId]
      );
      return r.rows[0] ?? null;
    });
    if (!linkedEntry) {
      return { ok: false, error: 'The linked log entry was not found.' };
    }
    shiftEntryId = entryId;
  }

  try {
    await withUser(session.profile.id, (q) =>
      q(
        'INSERT INTO shift_action_items (business_id, shift_entry_id, title, due_date, escalation_days, flagged_next, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          businessId,
          shiftEntryId,
          title,
          dueDate,
          escalationDays,
          input.flagged_next === true,
          'open',
          session.profile.id,
        ]
      )
    );
  } catch {
    return { ok: false, error: 'Could not save the action item. Try again.' };
  }
  revalidatePath('/shift-log');
  return { ok: true };
}

/* Mark an action item done ----------------------------------------------------- */
export async function markActionItemDone(id: string): Promise<ActionResult> {
  const { session, businessId } = await authed();
  if (!id) {
    return { ok: false, error: 'Missing action item.' };
  }
  try {
    await withUser(session.profile.id, (q) =>
      q(
        "UPDATE shift_action_items SET status = 'done', done_at = $1 WHERE id = $2 AND business_id = $3 AND status = 'open'",
        [new Date().toISOString(), id, businessId]
      )
    );
  } catch {
    return { ok: false, error: 'Could not mark the item done. Try again.' };
  }
  revalidatePath('/shift-log');
  return { ok: true };
}

/* Escalation sweep ---------------------------------------------------------------
   Runs on every shift-log page load: any open, not-yet-escalated item whose
   escalation date (due_date + escalation_days) is before today becomes
   escalated. Idempotent — escalated items are skipped. */
export async function runEscalationSweep(): Promise<{ escalated: number }> {
  const { session, businessId } = await authed();
  const today = todayLocal();

  const overdue = await withUser(session.profile.id, async (q) => {
    const r = await q(
      "SELECT id, due_date, escalation_days FROM shift_action_items WHERE business_id = $1 AND status = 'open' AND escalated = false",
      [businessId]
    );
    const rows = r.rows.map((row) => ({
      id: row.id as string,
      due_date: new Date(row.due_date).toISOString().slice(0, 10),
      escalation_days: Number(row.escalation_days),
    }));
    const due = rows.filter(
      (row) => today > addDays(row.due_date, Number(row.escalation_days))
    );
    for (const row of due) {
      await q(
        'UPDATE shift_action_items SET escalated = true, escalated_at = $1 WHERE id = $2 AND business_id = $3 AND escalated = false',
        [new Date().toISOString(), row.id, businessId]
      );
    }
    return due;
  });

  if (overdue.length > 0) {
    revalidatePath('/shift-log');
  }
  return { escalated: overdue.length };
}
