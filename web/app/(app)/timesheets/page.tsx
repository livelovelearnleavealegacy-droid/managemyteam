import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal, fmtDate, fmtDateTime } from '@/lib/format';
import { addDaysISO } from '@/lib/reports';
import { Badge, Card, EmptyState } from '@/components/ui';

function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h + 'h ' + m + 'm';
}

interface Entry {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export default async function TimesheetsPage() {
  const session = await requireManager();
  const today = todayLocal();
  const from = addDaysISO(today, -6); // last 7 days
  const windowEnd = addDaysISO(today, 1);

  const { rows: userRows } = await withUser(session.profile.id, (q) =>
    q('select id, name, terminated_at from users where business_id = $1 order by name', [
      session.business.id,
    ])
  );
  const { rows: entryRows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, user_id, clock_in, clock_out
       from time_clock_entries
       where business_id = $1 and clock_in >= $2 and clock_in < $3
       order by clock_in desc`,
      [session.business.id, from + 'T00:00:00', windowEnd + 'T00:00:00']
    )
  );
  const entries: Entry[] = entryRows.map((e) => ({
    id: String(e.id),
    user_id: String(e.user_id),
    clock_in: toISO(e.clock_in),
    clock_out: e.clock_out == null ? null : toISO(e.clock_out),
  }));

  const nameById: Record<string, { name: string; terminated: boolean }> = {};
  userRows.forEach((u) => {
    nameById[String(u.id)] = {
      name: String(u.name),
      terminated: !!u.terminated_at,
    };
  });

  const now = Date.now();
  const perUser = new Map<
    string,
    { closedMs: number; shifts: number; open: Entry[] }
  >();
  for (const e of entries) {
    const row = perUser.get(e.user_id) ?? { closedMs: 0, shifts: 0, open: [] };
    if (e.clock_out) {
      row.closedMs += new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime();
      row.shifts += 1;
    } else {
      row.open.push(e);
    }
    perUser.set(e.user_id, row);
  }

  const rows = Array.from(perUser.entries())
    .map(([userId, r]) => ({
      userId,
      name: nameById[userId]?.name ?? 'Unknown',
      terminated: nameById[userId]?.terminated ?? false,
      ...r,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openNow = rows.filter((r) => r.open.length > 0);

  return (
    <>
      <h1 className="page-title">Timesheets</h1>
      <p style={{ color: 'var(--text2)', marginTop: 4 }}>
        Last 7 days · {fmtDate(from)} – {fmtDate(today)}
      </p>

      {openNow.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2 className="section-title">Currently clocked in</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {openNow.map((r) =>
              r.open.map((e) => (
                <Card key={e.id}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <strong>{r.name}</strong>
                    <Badge tone="teal">Clocked in</Badge>
                  </div>
                  <p style={{ color: 'var(--text2)', margin: '8px 0 0' }}>
                    Since {fmtDateTime(e.clock_in)} ·{' '}
                    {fmtDuration(now - new Date(e.clock_in).getTime())} elapsed
                  </p>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      <h2 className="section-title" style={{ marginTop: 24 }}>
        Hours worked
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          title="No clock entries"
          body="Nobody clocked in during the last 7 days."
        />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Shifts</th>
              <th>Hours</th>
              <th>Open entries</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td>
                  {r.name}
                  {r.terminated && (
                    <span style={{ color: 'var(--text2)' }}> (terminated)</span>
                  )}
                </td>
                <td>{r.shifts}</td>
                <td>{fmtDuration(r.closedMs)}</td>
                <td>
                  {r.open.length > 0 ? (
                    <Badge tone="teal">
                      {r.open.length} open ·{' '}
                      {fmtDuration(
                        Math.max(
                          ...r.open.map(
                            (e) => now - new Date(e.clock_in).getTime()
                          )
                        )
                      )}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 12 }}>
        Open entries are excluded from hour totals.
      </p>
    </>
  );
}
