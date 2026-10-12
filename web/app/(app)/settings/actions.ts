'use server';

import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';

type ActionResult = { ok: true } | { ok: false; error: string };

async function authed() {
  const session = await requireAdmin();
  return { session, businessId: session.business.id };
}

function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

function pgMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

export async function updateBusinessName(name: string): Promise<ActionResult> {
  const { session, businessId } = await authed();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Business name is required' };

  try {
    await withUser(session.profile.id, (q) =>
      q('UPDATE businesses SET name = $1 WHERE id = $2', [trimmed, businessId])
    );
  } catch (e) {
    return { ok: false, error: 'Could not save: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function updateDefaultMaxPushes(value: number): Promise<ActionResult> {
  const { session, businessId } = await authed();
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, error: 'Max pushes must be a whole number, 0 or more' };
  }

  try {
    await withUser(session.profile.id, (q) =>
      q('UPDATE businesses SET default_max_pushes = $1 WHERE id = $2', [
        value,
        businessId,
      ])
    );
  } catch (e) {
    return { ok: false, error: 'Could not save: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function updateDigestSchedule(schedule: {
  enabled: boolean;
  time: string;
  timezone: string;
}): Promise<ActionResult> {
  const { session, businessId } = await authed();
  if (!/^[0-9]{2}:[0-9]{2}$/.test(schedule.time)) {
    return { ok: false, error: 'Time must be in HH:MM format' };
  }
  if (!schedule.timezone.trim()) {
    return { ok: false, error: 'Timezone is required' };
  }

  try {
    await withUser(session.profile.id, (q) =>
      q('UPDATE businesses SET digest_schedule = $1 WHERE id = $2', [
        JSON.stringify({
          enabled: schedule.enabled,
          time: schedule.time,
          timezone: schedule.timezone.trim(),
        }),
        businessId,
      ])
    );
  } catch (e) {
    return { ok: false, error: 'Could not save: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function createCategory(name: string): Promise<ActionResult> {
  const { session, businessId } = await authed();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Category name is required' };

  try {
    await withUser(session.profile.id, (q) =>
      q('INSERT INTO categories (business_id, name) VALUES ($1, $2)', [
        businessId,
        trimmed,
      ])
    );
  } catch (e) {
    if (pgCode(e) === '23505') {
      return { ok: false, error: 'A category with that name already exists' };
    }
    return { ok: false, error: 'Could not create category: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  const { session, businessId } = await authed();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Category name is required' };

  try {
    await withUser(session.profile.id, (q) =>
      q('UPDATE categories SET name = $1 WHERE id = $2 AND business_id = $3', [
        trimmed,
        id,
        businessId,
      ])
    );
  } catch (e) {
    if (pgCode(e) === '23505') {
      return { ok: false, error: 'A category with that name already exists' };
    }
    return { ok: false, error: 'Could not rename category: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const { session, businessId } = await authed();

  // Templates referencing this category are SET NULL, so delete is safe.
  try {
    await withUser(session.profile.id, (q) =>
      q('DELETE FROM categories WHERE id = $1 AND business_id = $2', [
        id,
        businessId,
      ])
    );
  } catch (e) {
    return { ok: false, error: 'Could not delete category: ' + pgMessage(e) };
  }
  return { ok: true };
}
