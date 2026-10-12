// POST /api/admin/users — admin-only staff management.
//
// Railway port: there is no Supabase Auth here. The login credential lives on
// public.users.password_hash (Auth.js credentials provider), so "creating an
// auth user" is a bcrypt hash + users row insert, and "deleting an auth user"
// is a DELETE FROM users (team_members cascades, shift_entries.user_id is
// SET NULL). All DB access runs on the owner pool via `db` (server-side ONLY;
// this file is never imported client-side). requireAdmin() runs first on
// every request.
//
// Actions:
//   { action: 'create', name, email, password, role, teamIds[] }
//   { action: 'terminate', userId, effectiveDate }
//   { action: 'reactivate', userId }
//   { action: 'delete', userId }  (requires the user to be terminated first)

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { todayLocal } from '@/lib/format';
import { setSubscriptionQuantity } from '@/lib/stripe';

const VALID_ROLES = ['admin', 'manager', 'staff'] as const;

function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

function pgMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

/** Re-syncs Stripe quantity after any active-count change. Best-effort: the
 *  quantity is also corrected on the next checkout/webhook, so a failure here
 *  must not block the staff change itself. */
async function syncSubscriptionQuantity(businessId: string): Promise<void> {
  const { rows } = await db.query(
    'SELECT stripe_subscription_id FROM businesses WHERE id = $1 LIMIT 1',
    [businessId]
  );
  const subscriptionId = rows[0]?.stripe_subscription_id as
    | string
    | null
    | undefined;
  if (!subscriptionId) return;

  const countRes = await db.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE business_id = $1 AND terminated_at IS NULL',
    [businessId]
  );
  const count = (countRes.rows[0]?.count as number) ?? 0;

  try {
    await setSubscriptionQuantity(subscriptionId, count);
  } catch (e) {
    console.error('setSubscriptionQuantity failed:', e);
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  const businessId = session.business.id;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }

  const action = body.action;

  // ------------------------------------------------------------------ create
  if (action === 'create') {
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const role = String(body.role ?? 'staff');
    const teamIds = Array.isArray(body.teamIds)
      ? body.teamIds.map(String)
      : [];

    if (!name) return badRequest('Name is required');
    if (!email || !email.includes('@')) return badRequest('A valid email is required');
    if (password.length < 8)
      return badRequest('Temporary password must be at least 8 characters');
    if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number]))
      return badRequest('Role must be admin, manager, or staff');

    // Validate team ids belong to this business before creating the user.
    if (teamIds.length > 0) {
      let teamRows: unknown[];
      try {
        const r = await db.query(
          'SELECT id FROM teams WHERE business_id = $1 AND id = ANY($2)',
          [businessId, teamIds]
        );
        teamRows = r.rows;
      } catch (e) {
        return badRequest('Could not validate teams: ' + pgMessage(e));
      }
      if (teamRows.length !== teamIds.length) {
        return badRequest('One or more selected teams are invalid');
      }
    }

    const existing = await db.query(
      'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
      [email]
    );
    if (existing.rows.length > 0) {
      return badRequest(
        'An account with that email already exists. Try signing in instead.'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let userId: string;
    try {
      const r = await db.query(
        'INSERT INTO users (id, business_id, email, name, role, password_hash) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id',
        [businessId, email, name, role, passwordHash]
      );
      userId = r.rows[0].id as string;
    } catch (e) {
      if (pgCode(e) === '23505') {
        return badRequest(
          'An account with that email already exists. Try signing in instead.'
        );
      }
      return badRequest('Could not create staff record: ' + pgMessage(e));
    }

    if (teamIds.length > 0) {
      try {
        // $1 = business_id, $2..$N+1 = team ids, $N+2 = user_id.
        const values = teamIds
          .map((_, i) => `($1, $${i + 2}, $${teamIds.length + 2})`)
          .join(', ');
        await db.query(
          `INSERT INTO team_members (business_id, team_id, user_id) VALUES ${values}`,
          [businessId, ...teamIds, userId]
        );
      } catch (e) {
        console.error('team_members insert failed:', e);
      }
    }

    await syncSubscriptionQuantity(businessId);
    return NextResponse.json({ ok: true, userId });
  }

  // ---------------------------------------------------------------- terminate
  if (action === 'terminate') {
    const userId = String(body.userId ?? '');
    const effectiveDate = String(body.effectiveDate ?? '');
    if (!userId) return badRequest('userId is required');
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(effectiveDate)) {
      return badRequest('A valid effective date (YYYY-MM-DD) is required');
    }
    const today = todayLocal();
    const maxFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (effectiveDate < today) {
      return badRequest('Effective date cannot be in the past');
    }
    if (effectiveDate > maxFuture) {
      return badRequest('Effective date cannot be more than 30 days out');
    }

    const target = (
      await db.query(
        'SELECT id, name, role, terminated_at FROM users WHERE id = $1 AND business_id = $2 LIMIT 1',
        [userId, businessId]
      )
    ).rows[0] as
      | { id: string; name: string; role: string; terminated_at: unknown }
      | undefined;
    if (!target) {
      return badRequest('Staff member not found');
    }
    if (target.terminated_at) {
      return badRequest(target.name + ' is already terminated');
    }

    // Last-active-admin guard.
    if (target.role === 'admin') {
      const countRes = await db.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE business_id = $1 AND role = 'admin' AND terminated_at IS NULL",
        [businessId]
      );
      const count = (countRes.rows[0]?.count as number) ?? 0;
      if (count <= 1) {
        return badRequest(
          'Cannot terminate the last active admin. Make someone else an admin first.'
        );
      }
    }

    try {
      await db.query(
        'UPDATE users SET terminated_at = $1, termination_effective_date = $2 WHERE id = $3 AND business_id = $4',
        [new Date().toISOString(), effectiveDate, userId, businessId]
      );
    } catch (e) {
      return badRequest('Could not terminate: ' + pgMessage(e));
    }

    // System shift-log entry (user_id NULL = system-generated).
    await db.query(
      'INSERT INTO shift_entries (business_id, user_id, shift_date, body, source, linked) VALUES ($1, NULL, $2, $3, $4, $5)',
      [
        businessId,
        today,
        target.name + ' terminated (effective ' + effectiveDate + ')',
        'auto:termination',
        JSON.stringify({ user_id: userId }),
      ]
    );

    await syncSubscriptionQuantity(businessId);
    return NextResponse.json({ ok: true });
  }

  // --------------------------------------------------------------- reactivate
  if (action === 'reactivate') {
    const userId = String(body.userId ?? '');
    if (!userId) return badRequest('userId is required');

    const target = (
      await db.query(
        'SELECT id, name, terminated_at FROM users WHERE id = $1 AND business_id = $2 LIMIT 1',
        [userId, businessId]
      )
    ).rows[0] as
      | { id: string; name: string; terminated_at: unknown }
      | undefined;
    if (!target) return badRequest('Staff member not found');
    if (!target.terminated_at) return badRequest(target.name + ' is already active');

    try {
      await db.query(
        'UPDATE users SET terminated_at = NULL, termination_effective_date = NULL WHERE id = $1 AND business_id = $2',
        [userId, businessId]
      );
    } catch (e) {
      return badRequest('Could not reactivate: ' + pgMessage(e));
    }

    // NOTE: reactivation does not restore team memberships. Re-add the person
    // to their teams from the Teams page if needed.
    await syncSubscriptionQuantity(businessId);
    return NextResponse.json({ ok: true });
  }

  // ------------------------------------------------------------------- delete
  if (action === 'delete') {
    const userId = String(body.userId ?? '');
    if (!userId) return badRequest('userId is required');

    const target = (
      await db.query(
        'SELECT id, name, terminated_at FROM users WHERE id = $1 AND business_id = $2 LIMIT 1',
        [userId, businessId]
      )
    ).rows[0] as
      | { id: string; name: string; terminated_at: unknown }
      | undefined;
    if (!target) return badRequest('Staff member not found');
    if (!target.terminated_at) {
      return badRequest('Terminate before deleting. Deletion is permanent.');
    }
    if (userId === session.profile.id) {
      return badRequest('You cannot delete your own account');
    }

    // No auth.users table on Railway: the credential lives on the users row
    // itself, team_members rows cascade, and shift_entries.user_id is SET NULL.
    try {
      await db.query('DELETE FROM users WHERE id = $1 AND business_id = $2', [
        userId,
        businessId,
      ]);
    } catch (e) {
      return badRequest('Could not delete: ' + pgMessage(e));
    }

    await syncSubscriptionQuantity(businessId);
    return NextResponse.json({ ok: true });
  }

  return badRequest('Unknown action: ' + String(action));
}
