import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { withUser } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { fmtDate, fmtTime } from '@/lib/format';
import { Button, Card, Toast, EmptyState } from '@/components/ui';
import ClockElapsed from './ClockElapsed';

interface EntryRow {
  id: string;
  clock_in: string;
  clock_out: string | null;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapEntry(r: {
  id: unknown;
  clock_in: unknown;
  clock_out: unknown;
}): EntryRow {
  return {
    id: String(r.id),
    clock_in: toISO(r.clock_in),
    clock_out: r.clock_out == null ? null : toISO(r.clock_out),
  };
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return m + ' min';
  return h + 'h ' + String(m).padStart(2, '0') + 'm';
}

async function clockIn() {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select id from time_clock_entries
       where user_id = $1 and clock_out is null
       limit 1`,
      [session.profile.id]
    )
  );
  if (rows[0]) {
    revalidatePath('/clock');
    redirect('/clock?msg=' + encodeURIComponent('You are already clocked in.'));
  }

  let error: unknown = null;
  try {
    await withUser(session.profile.id, (q) =>
      q(
        `insert into time_clock_entries (business_id, user_id, clock_in)
         values ($1, $2, $3)`,
        [session.profile.business_id, session.profile.id, new Date().toISOString()]
      )
    );
  } catch (e) {
    error = e;
  }

  revalidatePath('/clock');
  redirect('/clock?msg=' + encodeURIComponent(error ? 'Could not clock in.' : 'Clocked in.'));
}

async function clockOut() {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, clock_in from time_clock_entries
       where user_id = $1 and clock_out is null
       order by clock_in desc limit 1`,
      [session.profile.id]
    )
  );

  const open = rows[0] ?? null;
  if (!open) {
    revalidatePath('/clock');
    redirect('/clock?msg=' + encodeURIComponent('You are not clocked in.'));
  }

  let error: unknown = null;
  try {
    await withUser(session.profile.id, (q) =>
      q(
        'update time_clock_entries set clock_out = $1 where id = $2',
        [new Date().toISOString(), String(open.id)]
      )
    );
  } catch (e) {
    error = e;
  }

  revalidatePath('/clock');
  redirect('/clock?msg=' + encodeURIComponent(error ? 'Could not clock out.' : 'Clocked out.'));
}

export default async function ClockPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const sp = searchParams ?? {};
  const rawMsg = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;
  const msg = rawMsg ?? null;

  const { rows: openRows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, clock_in, clock_out from time_clock_entries
       where user_id = $1 and clock_out is null
       order by clock_in desc limit 1`,
      [session.profile.id]
    )
  );
  const openEntry = openRows[0] ? mapEntry(openRows[0]) : null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rows: historyRows } = await withUser(session.profile.id, (q) =>
    q(
      `select id, clock_in, clock_out from time_clock_entries
       where user_id = $1 and clock_in >= $2
       order by clock_in desc limit 50`,
      [session.profile.id, sevenDaysAgo]
    )
  );
  const history = historyRows.map(mapEntry);

  let totalMs = 0;
  for (const e of history) {
    const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
    totalMs += end - new Date(e.clock_in).getTime();
  }

  return (
    <div>
      <h1 className="page-title">Time clock</h1>
      <Toast message={msg} tone={msg && msg.includes('Could not') ? 'error' : 'success'} />

      <Card style={{ maxWidth: 560, textAlign: 'center', padding: 32 }}>
        {openEntry ? (
          <div>
            <div style={{ color: 'var(--green)', fontWeight: 700, marginBottom: 8 }}>
              ● Currently clocked in
            </div>
            <div style={{ marginBottom: 4 }}>
              Since <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtTime(openEntry.clock_in)}</span>{' '}
              on {fmtDate(openEntry.clock_in)}
            </div>
            <div style={{ fontSize: 28, marginBottom: 24 }}>
              <ClockElapsed clockIn={openEntry.clock_in} />
            </div>
            <form action={clockOut}>
              <Button type="submit" variant="danger" style={{ fontSize: 18, padding: '12px 40px' }}>
                Clock out
              </Button>
            </form>
          </div>
        ) : (
          <div>
            <div style={{ color: 'var(--text2)', fontWeight: 600, marginBottom: 24 }}>
              ○ Not clocked in
            </div>
            <form action={clockIn}>
              <Button type="submit" style={{ fontSize: 18, padding: '12px 40px' }}>
                Clock in
              </Button>
            </form>
          </div>
        )}
      </Card>

      <h2 className="section-title" style={{ marginTop: 32 }}>
        Last 7 days
      </h2>
      <Card style={{ maxWidth: 560 }}>
        <div style={{ fontSize: 24, fontFamily: 'var(--font-mono)' }}>
          {fmtDuration(totalMs)}
        </div>
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>total hours worked</div>
      </Card>

      <h2 className="section-title" style={{ marginTop: 32 }}>
        History
      </h2>
      {history.length === 0 ? (
        <EmptyState title="No clock entries" body="Your clock-in history for the last 7 days will appear here." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Clock in</th>
                <th>Clock out</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {history.map((e) => {
                const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
                const dur = end - new Date(e.clock_in).getTime();
                return (
                  <tr key={e.id}>
                    <td>{fmtDate(e.clock_in)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtTime(e.clock_in)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {e.clock_out ? fmtTime(e.clock_out) : '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {fmtDuration(dur)}
                      {!e.clock_out && ' (open)'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
