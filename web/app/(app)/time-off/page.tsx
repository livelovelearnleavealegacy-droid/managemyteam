import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { withUser } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { fmtDate, fmtDateTime, todayLocal } from '@/lib/format';
import {
  Button,
  TextInput,
  TextArea,
  Card,
  Badge,
  Field,
  Toast,
  EmptyState,
} from '@/components/ui';

interface RequestRow {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  decided_at: string | null;
  created_at: string;
  users: { name: string } | null;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapRow(r: {
  id: unknown;
  user_id: unknown;
  start_date: unknown;
  end_date: unknown;
  reason: unknown;
  status: unknown;
  decided_at: unknown;
  created_at: unknown;
  user_name: unknown;
}): RequestRow {
  const status = String(r.status);
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    start_date: String(r.start_date),
    end_date: String(r.end_date),
    reason: String(r.reason),
    status: status as 'pending' | 'approved' | 'denied',
    decided_at: r.decided_at == null ? null : toISO(r.decided_at),
    created_at: toISO(r.created_at),
    users: r.user_name == null ? null : { name: String(r.user_name) },
  };
}

function statusTone(status: string): 'gold' | 'green' | 'red' | 'neutral' {
  if (status === 'pending') return 'gold';
  if (status === 'approved') return 'green';
  if (status === 'denied') return 'red';
  return 'neutral';
}

async function requestTimeOff(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const startDate = String(formData.get('start_date') ?? '').trim();
  const endDate = String(formData.get('end_date') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!startDate || !endDate || !reason) {
    redirect('/time-off?msg=' + encodeURIComponent('Start date, end date, and reason are required.'));
  }
  if (endDate < startDate) {
    redirect('/time-off?msg=' + encodeURIComponent('End date must be on or after the start date.'));
  }

  let error: unknown = null;
  try {
    await withUser(session.profile.id, (q) =>
      q(
        `insert into time_off_requests (business_id, user_id, start_date, end_date, reason)
         values ($1, $2, $3, $4, $5)`,
        [session.profile.business_id, session.profile.id, startDate, endDate, reason]
      )
    );
  } catch (e) {
    error = e;
  }

  revalidatePath('/time-off');
  redirect(
    '/time-off?msg=' +
      encodeURIComponent(error ? 'Could not submit the request.' : 'Time off requested.')
  );
}

async function decideRequest(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (session.profile.role !== 'admin' && session.profile.role !== 'manager') {
    redirect('/overview');
  }

  const id = String(formData.get('id') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  if (!id || (decision !== 'approved' && decision !== 'denied')) {
    redirect('/time-off');
  }

  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select r.id, r.user_id, r.start_date, r.end_date, r.reason, r.status,
              r.decided_at, r.created_at, u.name as user_name
       from time_off_requests r
       left join users u on u.id = r.user_id
       where r.id = $1 and r.business_id = $2`,
      [id, session.profile.business_id]
    )
  );
  const req = rows[0] ? mapRow(rows[0]) : null;
  if (!req || req.status !== 'pending') {
    revalidatePath('/time-off');
    redirect('/time-off?msg=' + encodeURIComponent('That request is no longer pending.'));
  }

  let error: unknown = null;
  try {
    await withUser(session.profile.id, (q) =>
      q(
        `update time_off_requests
         set status = $1, decided_by = $2, decided_at = $3
         where id = $4`,
        [decision, session.profile.id, new Date().toISOString(), id]
      )
    );
  } catch (e) {
    error = e;
  }

  if (!error && decision === 'approved') {
    const name = req.users?.name ?? 'Staff member';
    await withUser(session.profile.id, (q) =>
      q(
        `insert into shift_entries (business_id, user_id, shift_date, source, body, linked)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          session.profile.business_id,
          req.user_id,
          todayLocal(),
          'auto:timeoff_approved',
          'Time off approved: ' +
            name +
            ' ' +
            fmtDate(req.start_date) +
            ' → ' +
            fmtDate(req.end_date),
          { request_id: id },
        ]
      )
    );
  }

  revalidatePath('/time-off');
  redirect(
    '/time-off?msg=' +
      encodeURIComponent(
        error
          ? 'Could not update the request.'
          : decision === 'approved'
            ? 'Request approved.'
            : 'Request denied.'
      )
  );
}

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  const isManager =
    session.profile.role === 'admin' || session.profile.role === 'manager';

  const sp = searchParams ?? {};
  const rawMsg = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;
  const msg = rawMsg ?? null;

  const params: string[] = [session.profile.business_id];
  if (!isManager) params.push(session.profile.id);
  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select r.id, r.user_id, r.start_date, r.end_date, r.reason, r.status,
              r.decided_at, r.created_at, u.name as user_name
       from time_off_requests r
       left join users u on u.id = r.user_id
       where r.business_id = $1${!isManager ? ' and r.user_id = $2' : ''}
       order by r.created_at desc limit 100`,
      params
    )
  );
  const requests = rows.map(mapRow);

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  function requestCard(r: RequestRow) {
    return (
      <Card key={r.id}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>
            {isManager ? (r.users?.name ?? 'former staff') + ' · ' : ''}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
            </span>
          </strong>
          <Badge tone={statusTone(r.status)}>
            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
          </Badge>
        </div>
        <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{r.reason}</p>
        <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Requested {fmtDateTime(r.created_at)}
          {r.decided_at ? ' · decided ' + fmtDateTime(r.decided_at) : ''}
        </div>
        {isManager && r.status === 'pending' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <form action={decideRequest}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="decision" value="approved" />
              <Button type="submit">Approve</Button>
            </form>
            <form action={decideRequest}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="decision" value="denied" />
              <Button type="submit" variant="danger">
                Deny
              </Button>
            </form>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div>
      <h1 className="page-title">Time off</h1>
      <Toast message={msg} tone={msg && msg.includes('Could not') ? 'error' : 'success'} />

      <Card style={{ maxWidth: 560, marginBottom: 32 }}>
        <h2 className="section-title">Request time off</h2>
        <form action={requestTimeOff}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Start date" htmlFor="to-start">
              <TextInput id="to-start" name="start_date" type="date" required />
            </Field>
            <Field label="End date" htmlFor="to-end">
              <TextInput id="to-end" name="end_date" type="date" required />
            </Field>
          </div>
          <Field label="Reason" htmlFor="to-reason">
            <TextArea id="to-reason" name="reason" required rows={3} />
          </Field>
          <Button type="submit">Submit request</Button>
        </form>
      </Card>

      {isManager && pending.length > 0 && (
        <div>
          <h2 className="section-title">Pending requests ({pending.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
            {pending.map(requestCard)}
          </div>
        </div>
      )}

      <h2 className="section-title">
        {isManager ? 'Decided requests' : 'My requests'}
      </h2>
      {(isManager ? decided : requests).length === 0 ? (
        <EmptyState title="Nothing here yet" body="Decided requests will appear here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(isManager ? decided : requests).map(requestCard)}
        </div>
      )}
    </div>
  );
}
