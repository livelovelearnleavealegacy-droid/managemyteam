import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { Card, EmptyState, TextInput, Field, Badge, Button } from '@/components/ui';

interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const { rows: userRows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, name, email, role from users
       where business_id = $1 and terminated_at is null
       order by name`,
      [session.profile.business_id]
    )
  );
  const allUsers: DirectoryUser[] = userRows.map((u) => ({
    id: String(u.id),
    name: String(u.name),
    email: String(u.email),
    role: String(u.role),
  }));

  const { rows: memberRows } = await withUser(session.profile.id, (q) =>
    q(
      `select tm.user_id, tm.team_id
       from team_members tm
       join teams t on t.id = tm.team_id
       where t.business_id = $1`,
      [session.profile.business_id]
    )
  );

  const { rows: teamRows } = await withUser(session.profile.id, (q) =>
    q('select id, name from teams where business_id = $1', [
      session.profile.business_id,
    ])
  );
  const teamNames = new Map<string, string>(
    teamRows.map((t) => [String(t.id), String(t.name)])
  );
  const userTeams = new Map<string, string[]>();
  for (const m of memberRows) {
    const name = teamNames.get(String(m.team_id));
    if (!name) continue;
    const list = userTeams.get(String(m.user_id)) ?? [];
    list.push(name);
    userTeams.set(String(m.user_id), list);
  }

  const q = (searchParams.q ?? '').trim().toLowerCase();
  const users = q
    ? allUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      )
    : allUsers;

  return (
    <>
      <h1 className="page-title">Staff directory</h1>

      <Card style={{ marginTop: 16 }}>
        <form method="get" action="/directory">
          <Field label="Search staff" htmlFor="dir-search">
            <div style={{ display: 'flex', gap: 8 }}>
              <TextInput
                id="dir-search"
                name="q"
                defaultValue={searchParams.q ?? ''}
                placeholder="Search by name or email..."
                style={{ flex: 1 }}
              />
              <Button type="submit">Search</Button>
              {q && (
                <Link href="/directory" className="btn btn-ghost">
                  Clear
                </Link>
              )}
            </div>
          </Field>
        </form>
      </Card>

      <div style={{ marginTop: 24 }}>
        {users.length === 0 ? (
          <EmptyState
            title={q ? 'No staff match your search' : 'No staff found'}
            body={q ? 'Try a different search term.' : undefined}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Teams</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <Badge tone="neutral">{u.role}</Badge>
                  </td>
                  <td style={{ color: 'var(--text2)' }}>
                    {(userTeams.get(u.id) ?? []).sort().join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
