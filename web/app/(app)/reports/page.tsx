import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { todayLocal, fmtDate } from '@/lib/format';
import {
  computeAggregates,
  fetchInstanceRows,
  rangeBounds,
  rangeTitle,
  type RangeKey,
} from '@/lib/reports';
import { Badge, Button, Card, Field, TextInput } from '@/components/ui';

const RANGES: RangeKey[] = ['today', 'week', 'month'];

function isRange(v: string | undefined): v is RangeKey {
  return v === 'today' || v === 'week' || v === 'month';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: { range?: string; mailed?: string };
}) {
  const session = await requireManager();
  const range: RangeKey = isRange(searchParams?.range)
    ? searchParams.range
    : 'week';
  const today = todayLocal();
  const { from, to } = rangeBounds(range, today);
  const { staff, instances } = await withUser(session.profile.id, (q) =>
    fetchInstanceRows(
      q,
      session.business.id,
      session.business.default_max_pushes,
      from,
      to,
      today
    )
  );
  const agg = computeAggregates(staff, instances);
  const t = agg.totals;
  const mailed = searchParams?.mailed;

  return (
    <>
      <h1 className="page-title">Reports</h1>

      {mailed === 'sent' && (
        <p role="status" style={{ color: 'var(--green)' }}>
          Report sent.
        </p>
      )}
      {mailed === 'skipped' && (
        <p role="status" style={{ color: 'var(--gold)' }}>
          Email is not configured (no Resend API key), so nothing was sent.
        </p>
      )}
      {mailed === 'failed' && (
        <p role="status" style={{ color: 'var(--red)' }}>
          The report could not be sent. Please try again.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px' }}>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={'/reports?range=' + r}
            className={'btn ' + (r === range ? 'btn-primary' : 'btn-ghost')}
            aria-current={r === range ? 'page' : undefined}
          >
            {rangeTitle(r)}
          </Link>
        ))}
      </div>

      <p style={{ color: 'var(--text2)' }}>
        {fmtDate(from)} – {fmtDate(to)}
      </p>

      <h2 className="section-title">Totals</h2>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Badge>Instances: {t.instances}</Badge>
          <Badge tone="green">Completed: {t.completed}</Badge>
          <Badge tone="gold">Pushed: {t.pushed}</Badge>
          <Badge tone="red">Delinquent: {t.delinquent}</Badge>
          <Badge tone="gold">Overdue: {t.overdue}</Badge>
          <Badge tone="teal">Due today: {t.dueToday}</Badge>
        </div>
      </Card>

      <h2 className="section-title" style={{ marginTop: 24 }}>
        Per staff
      </h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>Instances</th>
            <th>Completed</th>
            <th>Pushed</th>
            <th>Delinquent</th>
            <th>Overdue</th>
            <th>Due today</th>
          </tr>
        </thead>
        <tbody>
          {agg.perStaff.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.instances}</td>
              <td>{r.completed}</td>
              <td>{r.pushed}</td>
              <td>{r.delinquent}</td>
              <td>{r.overdue}</td>
              <td>{r.dueToday}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title" style={{ marginTop: 24 }}>
        Per category
      </h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>Category</th>
            <th>Instances</th>
            <th>Completed</th>
            <th>Pushed</th>
            <th>Delinquent</th>
          </tr>
        </thead>
        <tbody>
          {agg.perCategory.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.instances}</td>
              <td>{r.completed}</td>
              <td>{r.pushed}</td>
              <td>{r.delinquent}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title" style={{ marginTop: 24 }}>
        Delinquency detail
      </h2>
      {agg.delinquents.length === 0 ? (
        <p style={{ color: 'var(--text2)' }}>
          No delinquent tasks in this range. Nice work.
        </p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Task</th>
              <th>Instance date</th>
              <th>Assignee</th>
              <th>Pushes used</th>
            </tr>
          </thead>
          <tbody>
            {agg.delinquents.map((d) => (
              <tr key={d.instanceKey}>
                <td>{d.title}</td>
                <td>{fmtDate(d.originalDate)}</td>
                <td>{d.assigneeNames}</td>
                <td>
                  {d.pushCount} of {d.maxPushes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section-title" style={{ marginTop: 24 }}>
        Email this report
      </h2>
      <form action="/api/reports/email" method="post" style={{ maxWidth: 480 }}>
        <input type="hidden" name="range" value={range} />
        <Field label="Send to" htmlFor="to">
          <TextInput
            id="to"
            name="to"
            type="email"
            required
            placeholder="manager@example.com"
          />
        </Field>
        <Button type="submit">Send report</Button>
      </form>
    </>
  );
}
