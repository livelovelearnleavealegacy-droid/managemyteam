'use server';

import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';

type ActionResult = { ok: true } | { ok: false; error: string };

async function authed() {
  const session = await requireManager();
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

export async function createTeam(name: string): Promise<ActionResult> {
  const { session, businessId } = await authed();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Team name is required' };

  try {
    await withUser(session.profile.id, (q) =>
      q('INSERT INTO teams (business_id, name) VALUES ($1, $2)', [
        businessId,
        trimmed,
      ])
    );
  } catch (e) {
    if (pgCode(e) === '23505') {
      return { ok: false, error: 'A team with that name already exists' };
    }
    return { ok: false, error: 'Could not create team: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function renameTeam(id: string, name: string): Promise<ActionResult> {
  const { session, businessId } = await authed();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Team name is required' };

  try {
    await withUser(session.profile.id, (q) =>
      q('UPDATE teams SET name = $1 WHERE id = $2 AND business_id = $3', [
        trimmed,
        id,
        businessId,
      ])
    );
  } catch (e) {
    if (pgCode(e) === '23505') {
      return { ok: false, error: 'A team with that name already exists' };
    }
    return { ok: false, error: 'Could not rename team: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function deleteTeam(id: string): Promise<ActionResult> {
  const { session, businessId } = await authed();

  try {
    await withUser(session.profile.id, (q) =>
      q('DELETE FROM teams WHERE id = $1 AND business_id = $2', [id, businessId])
    );
  } catch (e) {
    // chat_messages.team_id is NO ACTION: a team with chat history cannot be
    // deleted while those messages exist.
    if (pgCode(e) === '23503') {
      return {
        ok: false,
        error:
          'This team has chat history and cannot be deleted while those messages exist.',
      };
    }
    return { ok: false, error: 'Could not delete team: ' + pgMessage(e) };
  }
  return { ok: true };
}

export async function setTeamMembers(
  teamId: string,
  userIds: string[]
): Promise<ActionResult> {
  const { session, businessId } = await authed();

  try {
    await withUser(session.profile.id, async (q) => {
      const t = await q(
        'SELECT id FROM teams WHERE id = $1 AND business_id = $2 LIMIT 1',
        [teamId, businessId]
      );
      if (!t.rows[0]) {
        throw new Error('TEAM_NOT_FOUND');
      }

      await q(
        'DELETE FROM team_members WHERE team_id = $1 AND business_id = $2',
        [teamId, businessId]
      );

      if (userIds.length > 0) {
        // $1 = business_id, $2..$N+1 = user ids, $N+2 = team_id.
        const values = userIds
          .map((_, i) => `($1, $${i + 2}, $${userIds.length + 2})`)
          .join(', ');
        await q(
          `INSERT INTO team_members (business_id, user_id, team_id) VALUES ${values}`,
          [businessId, ...userIds, teamId]
        );
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'TEAM_NOT_FOUND') {
      return { ok: false, error: 'Team not found' };
    }
    return { ok: false, error: 'Could not update members: ' + pgMessage(e) };
  }
  return { ok: true };
}
