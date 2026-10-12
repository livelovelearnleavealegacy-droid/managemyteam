// Staff page (admin only). Server component: loads staff, teams, and
// memberships, then hands them to the client manager below.

import { requireAdmin } from '@/lib/auth';
import { withUser } from '@/lib/db';
import StaffManager from './staff-manager';

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'staff';
  terminated_at: string | null;
  termination_effective_date: string | null;
}

export interface TeamRow {
  id: string;
  name: string;
}

export default async function StaffPage() {
  const session = await requireAdmin();
  const businessId = session.business.id;

  const { userRows, teamRows, memberRows } = await withUser(
    session.profile.id,
    async (q) => {
      // Queried sequentially: a single pg client cannot run queries concurrently.
      const u = await q(
        'SELECT id, name, email, role, terminated_at, termination_effective_date FROM users WHERE business_id = $1 ORDER BY name',
        [businessId]
      );
      const t = await q(
        'SELECT id, name FROM teams WHERE business_id = $1 ORDER BY name',
        [businessId]
      );
      const m = await q(
        'SELECT tm.team_id, tm.user_id, teams.name AS team_name ' +
          'FROM team_members tm JOIN teams ON teams.id = tm.team_id ' +
          'WHERE tm.business_id = $1',
        [businessId]
      );
      return { userRows: u.rows, teamRows: t.rows, memberRows: m.rows };
    }
  );

  const users: StaffUser[] = userRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    role: r.role as 'admin' | 'manager' | 'staff',
    terminated_at: r.terminated_at
      ? new Date(r.terminated_at).toISOString()
      : null,
    termination_effective_date: r.termination_effective_date
      ? new Date(r.termination_effective_date).toISOString().slice(0, 10)
      : null,
  }));

  const teams: TeamRow[] = teamRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  // user_id -> list of team names.
  const memberships: Record<string, string[]> = {};
  for (const m of memberRows) {
    const teamName = m.team_name as string | null;
    const userId = m.user_id as string;
    if (teamName) {
      const list = memberships[userId] ?? [];
      list.push(teamName);
      memberships[userId] = list;
    }
  }

  return (
    <div>
      <h1 className="page-title">Staff</h1>
      <StaffManager
        initialUsers={users}
        teams={teams}
        memberships={memberships}
        selfId={session.profile.id}
      />
    </div>
  );
}
