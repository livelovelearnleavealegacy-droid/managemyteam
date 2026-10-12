import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { withUser } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { fmtDate, todayLocal } from '@/lib/format';
import {
  Button,
  TextInput,
  TextArea,
  Select,
  Card,
  Field,
  Toast,
  EmptyState,
} from '@/components/ui';
import DeleteShiftButton from './DeleteShiftButton';

interface ShiftRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  notes: string;
  user_id: string;
  users: { name: string } | null;
}

interface StaffRow {
  id: string;
  name: string;
}

function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/** "09:00:00" -> "9:00 AM" */
function fmtClock(t: string): string {
  const parts = t.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function createShift(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (session.profile.role !== 'admin' && session.profile.role !== 'manager') {
    redirect('/overview');
  }

  const userId = String(formData.get('user_id') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const startTime = String(formData.get('start_time') ?? '').trim();
  const endTime = String(formData.get('end_time') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const week = String(formData.get('week') ?? '0');

  if (!userId || !date || !startTime || !endTime) {
    redirect('/schedule?week=' + encodeURIComponent(week) + '&msg=' + encodeURIComponent('Person, date, start and end times are required.'));
  }

  let error: unknown = null;
  try {
    await withUser(session.profile.id, (q) =>
      q(
        `insert into shifts (business_id, user_id, date, start_time, end_time, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.profile.business_id,
          userId,
          date,
          startTime,
          endTime,
          notes,
          session.profile.id,
        ]
      )
    );
  } catch (e) {
    error = e;
  }

  revalidatePath('/schedule');
  redirect(
    '/schedule?week=' +
      encodeURIComponent(week) +
      '&msg=' +
      encodeURIComponent(error ? 'Could not save the shift.' : 'Shift assigned.')
  );
}

async function deleteShift(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (session.profile.role !== 'admin' && session.profile.role !== 'manager') {
    redirect('/overview');
  }

  const id = String(formData.get('id') ?? '').trim();
  const week = String(formData.get('week') ?? '0');
  if (!id) redirect('/schedule?week=' + encodeURIComponent(week));

  let error: unknown = null;
  try {
    await withUser(session.profile.id, (q) =>
      q('delete from shifts where id = $1 and business_id = $2', [
        id,
        session.profile.business_id,
      ])
    );
  } catch (e) {
    error = e;
  }

  revalidatePath('/schedule');
  redirect(
    '/schedule?week=' +
      encodeURIComponent(week) +
      '&msg=' +
      encodeURIComponent(error ? 'Could not delete the shift.' : 'Shift deleted.')
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  const isManager =
    session.profile.role === 'admin' || session.profile.role === 'manager';

  const sp = searchParams ?? {};
  const rawWeek = Array.isArray(sp.week) ? sp.week[0] : sp.week;
  const week = Number(rawWeek ?? '0') || 0;
  const rawMsg = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;
  const msg = rawMsg ?? null;

  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - mondayOffset + week * 7
  );
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const weekStart = isoDay(days[0]);
  const weekEnd = isoDay(days[6]);

  const params: (string)[] = [session.profile.business_id, weekStart, weekEnd];
  if (!isManager) params.push(session.profile.id);
  const { rows: shiftRows } = await withUser(session.profile.id, (q) =>
    q(
      `select s.id, s.date, s.start_time, s.end_time, s.notes, s.user_id, u.name as user_name
       from shifts s left join users u on u.id = s.user_id
       where s.business_id = $1 and s.date >= $2 and s.date <= $3${
         !isManager ? ' and s.user_id = $4' : ''
       }
       order by s.date asc, s.start_time asc`,
      params
    )
  );
  const shifts: ShiftRow[] = shiftRows.map((s) => ({
    id: String(s.id),
    date: String(s.date),
    start_time: String(s.start_time),
    end_time: String(s.end_time),
    notes: String(s.notes ?? ''),
    user_id: String(s.user_id),
    users: s.user_name == null ? null : { name: String(s.user_name) },
  }));

  const byDate = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }

  let staff: StaffRow[] = [];
  if (isManager) {
    const { rows: staffRows } = await withUser(session.profile.id, (q) =>
      q(
        `select id, name from users
         where business_id = $1 and terminated_at is null
         order by name asc`,
        [session.profile.business_id]
      )
    );
    staff = staffRows.map((r) => ({ id: String(r.id), name: String(r.name) }));
  }

  const weekLabel =
    week === 0 ? 'This week' : week === 1 ? 'Next week' : week === -1 ? 'Last week' : '';

  return (
    <div>
      <h1 className="page-title">Schedule</h1>
      <Toast message={msg} tone={msg && msg.includes('Could not') ? 'error' : 'success'} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <Link href={'/schedule?week=' + (week - 1)} className="btn btn-ghost">
          &larr; Prev
        </Link>
        <span style={{ fontWeight: 600 }}>
          {weekLabel ? weekLabel + ' · ' : ''}
          {fmtDate(weekStart)} – {fmtDate(weekEnd)}
        </span>
        <Link href={'/schedule?week=' + (week + 1)} className="btn btn-ghost">
          Next &rarr;
        </Link>
        {week !== 0 && (
          <Link href="/schedule?week=0" className="btn btn-ghost">
            This week
          </Link>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(170px, 1fr))',
            gap: 12,
            minWidth: 900,
          }}
        >
          {days.map((d, i) => {
            const key = isoDay(d);
            const dayShifts = byDate.get(key) ?? [];
            const isToday = key === todayLocal();
            return (
              <div
                key={key}
                className="card"
                style={{
                  padding: 12,
                  borderColor: isToday ? 'var(--teal)' : undefined,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: 2,
                    color: isToday ? 'var(--teal)' : 'var(--text)',
                  }}
                >
                  {DAY_NAMES[i]}
                  {isToday ? ' ●' : ''}
                </div>
                <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 8 }}>
                  {fmtDate(key)}
                </div>
                {dayShifts.length === 0 ? (
                  <div style={{ color: 'var(--text2)', fontSize: 13 }}>—</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dayShifts.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          background: 'var(--panel2)',
                          borderRadius: 8,
                          padding: 8,
                          fontSize: 13,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{s.users?.name ?? '—'}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          {fmtClock(s.start_time)} – {fmtClock(s.end_time)}
                        </div>
                        {s.notes && (
                          <div style={{ color: 'var(--text2)', marginTop: 2 }}>{s.notes}</div>
                        )}
                        {isManager && (
                          <div style={{ marginTop: 6 }}>
                            <DeleteShiftButton id={s.id} week={week} onDelete={deleteShift} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isManager && (
        <Card style={{ marginTop: 24, maxWidth: 560 }}>
          <h2 className="section-title">Assign a shift</h2>
          <form action={createShift}>
            <input type="hidden" name="week" value={String(week)} />
            <Field label="Person" htmlFor="shift-user">
              <Select id="shift-user" name="user_id" required defaultValue="">
                <option value="" disabled>
                  Select a person…
                </option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Field label="Date" htmlFor="shift-date" className="field-inline">
                <TextInput
                  id="shift-date"
                  name="date"
                  type="date"
                  required
                  defaultValue={todayLocal()}
                />
              </Field>
              <Field label="Start time" htmlFor="shift-start">
                <TextInput id="shift-start" name="start_time" type="time" required />
              </Field>
              <Field label="End time" htmlFor="shift-end">
                <TextInput id="shift-end" name="end_time" type="time" required />
              </Field>
            </div>
            <Field label="Notes" htmlFor="shift-notes">
              <TextArea id="shift-notes" name="notes" rows={2} placeholder="Optional" />
            </Field>
            <Button type="submit">Assign shift</Button>
          </form>
        </Card>
      )}

      {!isManager && shifts.length === 0 && (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="No shifts this week"
            body="You have no shifts scheduled for this week."
          />
        </div>
      )}
    </div>
  );
}
