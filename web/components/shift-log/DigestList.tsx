import { fmtDate, fmtDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import type { ShiftDigest } from './types';

/** Past shift digests, newest first, with expandable summaries. */
export default function DigestList({ digests }: { digests: ShiftDigest[] }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 className="section-title">Past digests</h2>
      {digests.length === 0 ? (
        <EmptyState
          title="No digests yet"
          body="Digests are generated automatically on the business digest schedule, or on demand from the shift-digest API."
        />
      ) : (
        digests.map((digest) => (
          <details key={digest.id} className="card" style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {fmtDate(digest.period_start)} – {fmtDate(digest.period_end)}
              <span style={{ color: 'var(--text2)', fontWeight: 400, marginLeft: 8 }}>
                Generated {fmtDateTime(digest.created_at)}
              </span>
            </summary>
            <div
              style={{
                marginTop: 12,
                whiteSpace: 'pre-wrap',
                color: 'var(--text)',
              }}
            >
              {digest.summary}
            </div>
          </details>
        ))
      )}
    </section>
  );
}
