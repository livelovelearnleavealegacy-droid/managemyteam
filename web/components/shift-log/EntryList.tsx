import Link from 'next/link';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Badge, EmptyState } from '@/components/ui';
import { linkedTarget, sourceLabel, sourceTone, type EntryGroup } from './types';

/** Log entries grouped by shift date, newest first. Server-rendered. */
export default function EntryList({ groups }: { groups: EntryGroup[] }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 className="section-title">Log entries</h2>
      {groups.length === 0 ? (
        <EmptyState
          title="No entries yet"
          body="Log the first note above and it will appear here, grouped by shift date."
        />
      ) : (
        groups.map((group) => (
          <div key={group.shift_date} style={{ marginBottom: 20 }}>
            <h3 className="section-title" style={{ fontSize: 16 }}>
              {fmtDate(group.shift_date)}
              <span style={{ color: 'var(--text2)', fontWeight: 400, marginLeft: 8 }}>
                {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
              </span>
            </h3>
            {group.entries.map((entry) => {
              const target = linkedTarget(entry);
              return (
                <div key={entry.id} className="card" style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        color: 'var(--text2)',
                      }}
                    >
                      {fmtDateTime(entry.created_at)}
                    </span>
                    <span style={{ fontWeight: 600 }}>{entry.author_name ?? 'System'}</span>
                    <Badge tone={sourceTone(entry.source)}>{sourceLabel(entry.source)}</Badge>
                    {target && (
                      <Link
                        href={target.href}
                        style={{ color: 'var(--teal)', fontSize: 14 }}
                      >
                        {target.label}
                      </Link>
                    )}
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{entry.body}</p>
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
