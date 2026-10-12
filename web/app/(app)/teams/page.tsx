// Teams page (manager and admin). Server component: loads teams, active
// staff, and memberships, then hands them to the client manager below.

import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import TeamsManager from './teams-manager';

export interface TeamRow {
  id: string;
  name: string;
}

export interface MemberRow {
  team_id: string;
  user_id: string;
}

export interface StaffOption {
  id: string;
  name: string;
  role: string;
}

export default async function TeamsPage() {
  const session = await requireManager();
  const businessId = session.business.id;

  const { teamRows, userRows, memberRows } = await withUser(
    session.profile.id,
    async (q) => {
      // Queried sequentially: a single pg client cannot run queries concurrently.
      const t = await q(
        'SELECT id, name FROM teams WHERE business_id = $1 ORDER BY name',
        [businessId]
      );
      const u = await q(
        'SELECT id, name, role FROM users WHERE business_id = $1 AND terminated_at IS NULL ORDER BY name',
        [businessId]
      );
      const m = await q(
        'SELECT team_id, user_id FROM team_members WHERE business_id = $1',
        [businessId]
      );
      return { teamRows: t.rows, userRows: u.rows, memberRows: m.rows };
    }
  );

  const teams: TeamRow[] = teamRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));
  const users: StaffOption[] = userRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as string,
  }));
  const members: MemberRow[] = memberRows.map((r) => ({
    team_id: r.team_id as string,
    user_id: r.user_id as string,
  }));

  return (
    <div>
      <h1 className="page-title">Teams</h1>
      <TeamsManager
        initialTeams={teams}
        users={users}
        initialMembers={members}
      />
    </div>
  );
}
