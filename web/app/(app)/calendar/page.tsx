import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal, fmtDate } from '@/lib/format';
import { fetchInstanceRows, type InstanceRow } from '@/lib/reports';
import { Badge, Card, EmptyState } from '@/components/ui';

const SEVERITY: Record<string, number> = {
  completed: 0,
  upcoming: 1,
  'due-today': 2,
  overdue: 3,
  delinquent: 4,
};

const TONE: Record<string, 'red' | 'gold' | 'teal' | 'green' | 'neutral'> = {
  delinquent: 'red',
  overdue: 'gold',
  'due-today': 'teal',
  completed: 'green',
  upcoming: 'neutral',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function shiftMonth(m: string, delta: number): string {
  const d = new Date(m + '-01T12:00:00');
  d.setMonth(d.getMonth() + delta);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

function monthName(m: string): string {
  return new Date(m + '-01T12:00:00').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function dayGlyph(day: InstanceRow[]): { glyph: string; color: string } {
  if (day.length === 0) return { glyph: '', color: '' };
  let worst = 0;
  let hasDelinquent = false;
  let allCompleted = true;
  for (const i of day) {
    const sev = SEVERITY[i.status] ?? 0;
    if (sev > worst) worst = sev;
    if (i.status === 'delinquent') hasDelinquent = true;
    if (i.status !== 'completed') allCompleted = false;
  }
  if (worst >= 3)
    return {
      glyph: '!',
      color: hasDelinquent ? 'var(--red)' : 'var(--gold)',
    };
  if (worst === 2) return { glyph: '•', color: 'var(--teal)' };
  if (allCompleted) return { glyph: '✓', color: 'var(--green)' };
  return { glyph: '', color: '' };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: { m?: string; day?: string };
}) {
  const session = await requireManager();
  const today = todayLocal();

  const mParam = searchParams?.m ?? '';
  const month = /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(mParam)
    ? mParam
    : today.slice(0, 7);
  const first = month + '-01';
  const lastDay = new Date(
    new Date(first + 'T12:00:00').getFullYear(),
    new Date(first + 'T12:00:00').getMonth() + 1,
    0
  ).getDate();
  const last = month + '-' + pad(lastDay);

  const { instances } = await withUser(session.profile.id, (q) =>
    fetchInstanceRows(
      q,
      session.business.id,
      session.business.default_max_pushes,
      first,
      last,
      today
    )
  );

  // Bucket by effective date (where pushed tasks actually land).
  const byDay = new Map<string, InstanceRow[]>();
  for (const i of instances) {
    const list = byDay.get(i.effectiveDate) ?? [];
    list.push(i);
    byDay.set(i.effectiveDate, list);
  }

  const leadBlanks = new Date(first + 'T12:00:00').getDay(); // 0 = Sunday
  const cells: (string | null)[] = [];
  for (let b = 0; b < leadBlanks; b++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(month + '-' + pad(d));

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const dayParam = searchParams?.day ?? '';
  const selectedDay =
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dayParam) &&
    dayParam >= first &&
    dayParam <= last
      ? dayParam
      : null;
  const selected = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <>
      <h1 className="page-title">Calendar</h1>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '12px 0 16px',
        }}
      >
        <Link className="btn btn-ghost" href={'/calendar?m=' + prev} aria-label="Previous month">
          ←
        </Link>
        <strong className="section-title" style={{ margin: 0 }}>
          {monthName(month)}
        </strong>
        <Link className="btn btn-ghost" href={'/calendar?m=' + next} aria-label="Next month">
          →
        </Link>
      </div>

      <Card>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 4,
          }}
        >
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              style={{
                textAlign: 'center',
                color: 'var(--text2)',
                fontSize: 12,
                textTransform: 'uppercase',
                padding: '4px 0',
              }}
            >
              {w}
            </div>
          ))}
          {cells.map((iso, idx) =>
            iso === null ? (
              <div key={'blank-' + idx} />
            ) : (
              <Link
                key={iso}
                href={'/calendar?m=' + month + '&day=' + iso}
                style={{
                  display: 'block',
                  minHeight: 56,
                  padding: 6,
                  borderRadius: 8,
                  background:
                    iso === today
                      ? 'var(--panel2)'
                      : iso === selectedDay
                        ? 'var(--panel2)'
                        : 'transparent',
                  border:
                    iso === selectedDay
                      ? '1px solid var(--teal)'
                      : '1px solid transparent',
                  color: 'var(--text)',
                  textDecoration: 'none',
                }}
                title={iso === today ? 'Today' : undefined}
              >
                <div style={{ fontSize: 13 }}>{Number(iso.slice(8))}</div>
                {(() => {
                  const g = dayGlyph(byDay.get(iso) ?? []);
                  return g.glyph ? (
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: g.color,
                        lineHeight: 1.4,
                      }}
                      aria-hidden="true"
                    >
                      {g.glyph}
                    </div>
                  ) : null;
                })()}
              </Link>
            )
          )}
        </div>
      </Card>

      <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 12 }}>
        Legend: <strong style={{ color: 'var(--red)' }}>!</strong> delinquent or
        overdue · <strong style={{ color: 'var(--teal)' }}>•</strong> due today ·{' '}
        <strong style={{ color: 'var(--green)' }}>✓</strong> everything completed
        · blank means nothing due.
      </p>

      {selectedDay && (
        <div style={{ marginTop: 16 }}>
          <h2 className="section-title">{fmtDate(selectedDay)}</h2>
          {selected.length === 0 ? (
            <EmptyState
              title="Nothing due"
              body="No task instances fall on this day."
            />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assignee</th>
                  <th>Original date</th>
                  <th>Pushes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selected
                  .slice()
                  .sort((a, b) =>
                    b.status === a.status
                      ? a.title.localeCompare(b.title)
                      : (SEVERITY[b.status] ?? 0) - (SEVERITY[a.status] ?? 0)
                  )
                  .map((i) => (
                    <tr key={i.instanceKey}>
                      <td>{i.title}</td>
                      <td>{i.assigneeNames}</td>
                      <td>{fmtDate(i.originalDate)}</td>
                      <td>
                        {i.pushCount > 0
                          ? i.pushCount + ' of ' + i.maxPushes
                          : '—'}
                      </td>
                      <td>
                        <Badge tone={TONE[i.status] ?? 'neutral'}>
                          {i.status === 'due-today'
                            ? 'Due today'
                            : i.status.charAt(0).toUpperCase() + i.status.slice(1)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
