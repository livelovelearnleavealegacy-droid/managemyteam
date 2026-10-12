import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal, fmtDate } from '@/lib/format';
import { addDaysISO, fetchInstanceRows } from '@/lib/reports';
import { Badge, Card, EmptyState } from '@/components/ui';

const TONE: Record<string, 'red' | 'gold' | 'teal' | 'green'> = {
  delinquent: 'red',
  overdue: 'gold',
  'due-today': 'teal',
  completed: 'green',
};

const LABEL: Record<string, string> = {
  completed: 'Done',
  'due-today': 'Due today',
  overdue: 'Overdue',
  delinquent: 'Delinquent',
};

export default async function OverviewPage() {
  const session = await requireManager();
  const today = todayLocal();
  const from = addDaysISO(today, -59); // trailing 60 days
  const { staff, instances } = await withUser(session.profile.id, (q) =>
    fetchInstanceRows(
      q,
      session.business.id,
      session.business.default_max_pushes,
      from,
      today,
      today
    )
  );

  const cards = staff.map((s) => {
    const mine = instances.filter((i) => i.assigneeIds.includes(s.id));
    const counts: Record<string, number> = {
      completed: 0,
      'due-today': 0,
      overdue: 0,
      delinquent: 0,
    };
    for (const i of mine) {
      if (counts[i.status] !== undefined) counts[i.status] += 1;
    }
    return { staff: s, total: mine.length, counts };
  });
  cards.sort((a, b) =>
    b.counts.delinquent !== a.counts.delinquent
      ? b.counts.delinquent - a.counts.delinquent
      : b.counts.overdue !== a.counts.overdue
        ? b.counts.overdue - a.counts.overdue
        : a.staff.name.localeCompare(b.staff.name)
  );

  return (
    <>
      <h1 className="page-title">Daily board</h1>
      <p style={{ color: 'var(--text2)', marginTop: 4 }}>
        Trailing 60 days · {fmtDate(from)} – {fmtDate(today)}
      </p>

      {cards.length === 0 ? (
        <EmptyState
          title="No staff yet"
          body="Add team members to start tracking tasks."
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
            marginTop: 16,
          }}
        >
          {cards.map(({ staff: s, total, counts }) => (
            <Card key={s.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <strong>{s.name}</strong>
                <span style={{ color: 'var(--text2)', fontSize: 13 }}>
                  {s.role} · {total} task{total === 1 ? '' : 's'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {(['completed', 'due-today', 'overdue', 'delinquent'] as const).map(
                  (k) => (
                    <Badge key={k} tone={TONE[k]}>
                      {LABEL[k]}: {counts[k]}
                    </Badge>
                  )
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
