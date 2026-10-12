import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { withUser } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { fmtDateTime, todayLocal } from '@/lib/format';
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

interface InspectionRow {
  id: string;
  area: string;
  checklist: { clean: boolean; hazard_free: boolean; equipment_ok: boolean };
  passed: boolean;
  notes: string;
  created_at: string;
  users: { name: string } | null;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

const CHECKS = [
  { key: 'clean', label: 'Clean' },
  { key: 'hazard_free', label: 'Hazard-free' },
  { key: 'equipment_ok', label: 'Equipment OK' },
] as const;

async function fileInspection(formData: FormData) {
  'use server';
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const area = String(formData.get('area') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (!area) {
    redirect('/inspections?msg=' + encodeURIComponent('Area is required.'));
  }

  const checklist = {
    clean: formData.get('clean') === 'on',
    hazard_free: formData.get('hazard_free') === 'on',
    equipment_ok: formData.get('equipment_ok') === 'on',
  };
  const passed = checklist.clean && checklist.hazard_free && checklist.equipment_ok;

  let insertedId: string | null = null;
  try {
    const { rows } = await withUser(session.profile.id, (q) =>
      q(
        `insert into inspections (business_id, user_id, area, checklist, passed, notes)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          session.profile.business_id,
          session.profile.id,
          area,
          checklist,
          passed,
          notes,
        ]
      )
    );
    insertedId = rows[0] ? String(rows[0].id) : null;
  } catch {
    insertedId = null;
  }

  if (!insertedId) {
    revalidatePath('/inspections');
    redirect('/inspections?msg=' + encodeURIComponent('Could not save the inspection.'));
  }

  if (!passed) {
    // Auto-log failed inspections to the shift log.
    await withUser(session.profile.id, (q) =>
      q(
        `insert into shift_entries (business_id, user_id, shift_date, source, body, linked)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          session.profile.business_id,
          session.profile.id,
          todayLocal(),
          'auto:inspection_failed',
          'Failed inspection: ' + area,
          { inspection_id: insertedId },
        ]
      )
    );
  }

  revalidatePath('/inspections');
  redirect(
    '/inspections?msg=' +
      encodeURIComponent(passed ? 'Inspection passed.' : 'Inspection recorded as failed.')
  );
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  const sp = searchParams ?? {};
  const rawMsg = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;
  const msg = rawMsg ?? null;

  const { rows } = await withUser(session.profile.id, (q) =>
    q(
      `select i.id, i.area, i.checklist, i.passed, i.notes, i.created_at, u.name as user_name
       from inspections i
       left join users u on u.id = i.user_id
       where i.business_id = $1
       order by i.created_at desc limit 100`,
      [session.profile.business_id]
    )
  );
  const inspections: InspectionRow[] = rows.map((r) => ({
    id: String(r.id),
    area: String(r.area),
    checklist: (r.checklist ?? {}) as {
      clean: boolean;
      hazard_free: boolean;
      equipment_ok: boolean;
    },
    passed: Boolean(r.passed),
    notes: String(r.notes ?? ''),
    created_at: toISO(r.created_at),
    users: r.user_name == null ? null : { name: String(r.user_name) },
  }));

  const areas = Array.from(new Set(inspections.map((i) => i.area))).sort();

  return (
    <div>
      <h1 className="page-title">Inspections</h1>
      <Toast message={msg} tone={msg && msg.includes('Could not') ? 'error' : 'success'} />

      <Card style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2 className="section-title">New inspection</h2>
        <form action={fileInspection}>
          <Field label="Area" htmlFor="insp-area">
            <TextInput
              id="insp-area"
              name="area"
              required
              maxLength={120}
              list="inspection-areas"
              placeholder="e.g. Kitchen, Loading dock"
            />
            <datalist id="inspection-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
            {CHECKS.map((c) => (
              <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" name={c.key} />
                {c.label}
              </label>
            ))}
          </div>
          <Field label="Notes" htmlFor="insp-notes">
            <TextArea
              id="insp-notes"
              name="notes"
              rows={3}
              placeholder="Anything worth noting (optional)."
            />
          </Field>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>
            An inspection passes only when all three checks are ticked. A failed inspection is
            logged to the shift log automatically.
          </p>
          <Button type="submit">Save inspection</Button>
        </form>
      </Card>

      <h2 className="section-title">Recent inspections</h2>
      {inspections.length === 0 ? (
        <EmptyState title="No inspections yet" body="Saved inspections will appear here." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Area</th>
                <th>Result</th>
                <th>Checks</th>
                <th>By</th>
                <th>When</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id}>
                  <td>{i.area}</td>
                  <td>
                    <Badge tone={i.passed ? 'green' : 'red'}>
                      {i.passed ? 'Passed' : 'Failed'}
                    </Badge>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {CHECKS.map((c) => (
                      <span key={c.key} style={{ marginRight: 10 }}>
                        {i.checklist?.[c.key] ? '✓' : '✗'} {c.label}
                      </span>
                    ))}
                  </td>
                  <td>{i.users?.name ?? 'former staff'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtDateTime(i.created_at)}</td>
                  <td style={{ fontSize: 13 }}>{i.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
