import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ownerPool } from '@/lib/db';

export type Role = 'admin' | 'manager' | 'staff';

export interface SessionProfile {
  id: string;
  business_id: string;
  name: string;
  email: string;
  role: Role;
  terminated_at: string | null;
}

export interface SessionBusiness {
  id: string;
  name: string;
  default_max_pushes: number;
  digest_schedule: Record<string, unknown>;
}

export interface Session {
  authUser: { id: string; email: string | null };
  profile: SessionProfile;
  business: SessionBusiness;
}

/**
 * Returns the current session (auth user + users profile + business),
 * or null when there is no signed-in user or the user has not onboarded yet
 * (authenticated but no users row).
 */
export async function getSessionUser(): Promise<Session | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { rows: profileRows } = await ownerPool.query(
    'SELECT id, business_id, name, email, role, terminated_at FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const profileRow = profileRows[0] as
    | {
        id: string;
        business_id: string;
        name: string;
        email: string;
        role: string;
        terminated_at: string | Date | null;
      }
    | undefined;
  if (!profileRow) return null;

  const { rows: businessRows } = await ownerPool.query(
    'SELECT id, name, default_max_pushes, digest_schedule FROM businesses WHERE id = $1 LIMIT 1',
    [profileRow.business_id]
  );
  const businessRow = businessRows[0] as
    | {
        id: string;
        name: string;
        default_max_pushes: number;
        digest_schedule: Record<string, unknown> | null;
      }
    | undefined;
  if (!businessRow) return null;

  return {
    authUser: { id: userId, email: session?.user?.email ?? null },
    profile: {
      id: profileRow.id,
      business_id: profileRow.business_id,
      name: profileRow.name,
      email: profileRow.email,
      role: profileRow.role as Role,
      terminated_at: profileRow.terminated_at
        ? new Date(profileRow.terminated_at).toISOString()
        : null,
    },
    business: {
      id: businessRow.id,
      name: businessRow.name,
      default_max_pushes: businessRow.default_max_pushes,
      digest_schedule: businessRow.digest_schedule ?? {},
    },
  };
}

/** Manager or admin. Redirects to /login when signed out, /overview when staff. */
export async function requireManager(): Promise<Session> {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (session.profile.role !== 'admin' && session.profile.role !== 'manager') {
    redirect('/overview');
  }
  return session;
}

/** Admin only. Redirects to /login when signed out, /overview when not admin. */
export async function requireAdmin(): Promise<Session> {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (session.profile.role !== 'admin') redirect('/overview');
  return session;
}
