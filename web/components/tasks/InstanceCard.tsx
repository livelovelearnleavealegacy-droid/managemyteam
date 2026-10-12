'use client';

/**
 * One instance row on the task board.
 * Status colors are locked by DESIGN.md: delinquent=red ONLY, overdue=gold,
 * due-today=teal, completed=green. Upcoming is neutral.
 */
import { useState } from 'react';
import { Badge, Button, Card } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import type { TaskStatus } from '@/lib/delinquency';
import { getPhotoSignedUrl } from '@/app/(app)/tasks/actions';
import type { BoardInstance } from './types';

const STATUS_LABEL: Record<TaskStatus, string> = {
  completed: 'Completed',
  delinquent: 'Delinquent',
  overdue: 'Overdue',
  'due-today': 'Due today',
  upcoming: 'Upcoming',
};

const STATUS_TONE: Record<TaskStatus, 'red' | 'gold' | 'teal' | 'green' | 'neutral'> = {
  completed: 'green',
  delinquent: 'red',
  overdue: 'gold',
  'due-today': 'teal',
  upcoming: 'neutral',
};

function PhotoButton({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setError(null);
    try {
      const url = await getPhotoSignedUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load photo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button
        variant="ghost"
        type="button"
        onClick={open}
        disabled={loading}
        aria-label="View completion photo"
      >
        {loading ? 'Loading photo…' : 'View photo'}
      </Button>
      {error && (
        <span role="status" style={{ color: 'var(--text2)', fontSize: 13 }}>
          {error}
        </span>
      )}
    </span>
  );
}

export default function InstanceCard({
  instance,
  pushing,
  onPush,
  onComplete,
}: {
  instance: BoardInstance;
  pushing: boolean;
  onPush: (instance: BoardInstance) => void;
  onComplete: (instance: BoardInstance) => void;
}) {
  const i = instance;
  const pushDisabled = pushing || i.completed || i.pushCount >= i.maxPushes;

  return (
    <Card
      style={{
        marginBottom: 12,
        borderLeft:
          i.status === 'delinquent'
            ? '3px solid var(--red)'
            : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{i.title}</strong>
            <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
            {i.categoryName && <Badge tone="neutral">{i.categoryName}</Badge>}
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 14, marginTop: 6 }}>
            {i.assignedTeamName ? (
              <>
                {i.assignedTeamName} team
                {i.assigneeNames.length > 0 &&
                  ` — ${i.assigneeNames.join(', ')}`}
              </>
            ) : (
              i.assigneeNames.join(', ')
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 14 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color:
                  i.status === 'delinquent'
                    ? 'var(--red)'
                    : i.status === 'overdue'
                      ? 'var(--gold)'
                      : 'var(--text)',
              }}
            >
              {fmtDate(i.effectiveDate)}
            </span>
            {i.pushCount > 0 && (
              <span style={{ color: 'var(--text2)', marginLeft: 8 }}>
                originally {fmtDate(i.originalDate)} · pushed {i.pushCount} of{' '}
                {i.maxPushes}
              </span>
            )}
            {i.pushCount === 0 && (
              <span style={{ color: 'var(--text2)', marginLeft: 8 }}>
                {i.maxPushes} {i.maxPushes === 1 ? 'push' : 'pushes'} allowed
              </span>
            )}
          </div>
          {i.completed && (
            <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text2)' }}>
              Completed{i.completedByName ? ` by ${i.completedByName}` : ''}
              {i.photoPath && (
                <>
                  {' · '}
                  <PhotoButton path={i.photoPath} />
                </>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {!i.completed && (
            <>
              <Button
                variant="ghost"
                type="button"
                onClick={() => onPush(i)}
                disabled={pushDisabled}
                title={
                  i.pushCount >= i.maxPushes
                    ? 'Push limit reached'
                    : 'Push to tomorrow'
                }
              >
                {pushing ? 'Pushing…' : 'Push'}
              </Button>
              <Button type="button" onClick={() => onComplete(i)}>
                Complete
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
