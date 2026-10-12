import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { withUser } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { fmtDateTime, todayLocal } from '@/lib/format';
import {
  Button,
  TextInput,
  TextArea,
  Select,
  Card,
  Badge,
  Field,
  Toast,
  EmptyState,
} from '@/components/ui';

interface IncidentRow {
  id: string;
  subject: string;
  severity: string | null;
  description: string;
  action_taken: string;
  created_at: string;
  user_id: string | null;
  users: { name: string } | null;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

const SEVERITIES = ['Minor', 'Moderate', 'Serious'] as const;

function severityTone(severity: string | null): 'green' | 'gold' | 'red' | 'neutral' {
  if (severity === 'Minor') return 'green';
  if (severity === 'Moderate') return 'gold';
  if (severity === 'Serious') return 'red';
  return 'neutral';
}

async function fileIncident(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const subject = String(formData.get('subject') ?? '').trim();
  const severity = String(formData.get('severity') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const actionTaken = String(formData.get('action_taken') ?? '').trim();

  if (!subject || !description) {
    redirect('/incidents?msg=' + encodeURIComponent('Subject and description are required.'));
  }
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
    redirect('/incidents?msg=' + encodeURIComponent('Choose a severity.'));
  }

  let insertedId: string | null = null;
  try {
    const { rows } = await withUser(session.profile.id, (q) =>
      q(
        `insert into incident_reports (business_id, user_id, subject, severity, description, action_taken)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          session.profile.business_id,
          session.profile.id,
          subject,
          severity,
          description,
          actionTaken,
        ]
      )
    );
    insertedId = rows[0] ? String(rows[0].id) : null;
  } catch {
    insertedId = null;
  }

  if (!insertedId) {
    revalidatePath('/incidents');
    redirect('/incidents?msg=' + encodeURIComponent('Could not file the report.'));
  }

  // Auto-log to the shift log (any member may insert auto:% entries).
  await withUser(session.profile.id, (q) =>
    q(
      `insert into shift_entries (business_id, user_id, shift_date, source, body, linked)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        session.profile.business_id,
        session.profile.id,
        todayLocal(),
        'auto:incident_filed',
        'Incident filed [' + severity + ']: ' + subject,
        { incident_id: insertedId },
      ]
    )
  );

  revalidatePath('/incidents');
  redirect('/incidents?msg=' + encodeURIComponent('Incident report filed.'));
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const sp = searchParams ?? {};
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (rawQ ?? '').trim();
  const rawMsg = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;
  const msg = rawMsg ?? null;

  const params: (string | null)[] = [session.profile.business_id];
  let searchClause = '';
  if (q) {
    // Parameterized ilike; %/_ are literal here since they ride in the param.
    const like = '%' + q + '%';
    searchClause = ' and (subject ilike $2 or description ilike $3)';
    params.push(like, like);
  }
  const { rows } = await withUser(session.profile.id, (qq) =>
    qq(
      `select ir.id, ir.subject, ir.severity, ir.description, ir.action_taken,
              ir.created_at, ir.user_id, u.name as user_name
       from incident_reports ir
       left join users u on u.id = ir.user_id
       where ir.business_id = $1${searchClause}
       order by ir.created_at desc limit 100`,
      params
    )
  );
  const incidents: IncidentRow[] = rows.map((r) => ({
    id: String(r.id),
    subject: String(r.subject),
    severity: r.severity == null ? null : String(r.severity),
    description: String(r.description),
    action_taken: String(r.action_taken ?? ''),
    created_at: toISO(r.created_at),
    user_id: r.user_id == null ? null : String(r.user_id),
    users: r.user_name == null ? null : { name: String(r.user_name) },
  }));

  return (
    <div>
      <h1 className="page-title">Incident reports</h1>
      <Toast message={msg} tone={msg && msg.includes('Could not') ? 'error' : 'success'} />

      <form method="GET" action="/incidents" style={{ display: 'flex', gap: 8, marginBottom: 16, maxWidth: 560 }}>
        <TextInput
          name="q"
          placeholder="Search subject or description…"
          defaultValue={q}
          aria-label="Search incident reports"
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="ghost">
          Search
        </Button>
        {q && (
          <a href="/incidents" className="btn btn-ghost">
            Clear
          </a>
        )}
      </form>

      {incidents.length === 0 ? (
        <EmptyState
          title={q ? 'No matches' : 'No incident reports'}
          body={q ? 'Nothing matched your search.' : 'File the first incident report below.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {incidents.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{r.subject}</strong>
                {r.severity && <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>}
              </div>
              <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
                Filed by {r.users?.name ?? 'former staff'} · {fmtDateTime(r.created_at)}
              </div>
              <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{r.description}</p>
              {r.action_taken && (
                <p style={{ marginTop: 8 }}>
                  <strong>Action taken:</strong>{' '}
                  <span style={{ whiteSpace: 'pre-wrap' }}>{r.action_taken}</span>
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card style={{ maxWidth: 640 }}>
        <h2 className="section-title">File a new report</h2>
        <form action={fileIncident}>
          <Field label="Subject" htmlFor="inc-subject">
            <TextInput id="inc-subject" name="subject" required maxLength={200} />
          </Field>
          <Field label="Severity" htmlFor="inc-severity">
            <Select id="inc-severity" name="severity" required defaultValue="">
              <option value="" disabled>
                Select severity…
              </option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="inc-desc">
            <TextArea
              id="inc-desc"
              name="description"
              required
              rows={4}
              placeholder="What happened, when, and who was involved."
            />
          </Field>
          <Field label="Action taken" htmlFor="inc-action">
            <TextArea
              id="inc-action"
              name="action_taken"
              rows={3}
              placeholder="What was done in response (optional)."
            />
          </Field>
          <Button type="submit">File report</Button>
        </form>
      </Card>
    </div>
  );
}
