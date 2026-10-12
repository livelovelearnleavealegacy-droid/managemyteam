'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createActionItem, markActionItemDone } from '@/app/(app)/shift-log/actions';
import { todayLocal, fmtDate, fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, Field, Select, TextInput, Toast } from '@/components/ui';
import type { ActionItemView, EntryOption } from './types';

/* Status presentation for one open item -------------------------------------- */
function statusFor(item: ActionItemView): {
  badge: React.ReactNode;
  detail: string;
} {
  if (item.escalated) {
    return {
      badge: <Badge tone="red">Escalated — notify GM</Badge>,
      detail: item.days_remaining < 0 ? Math.abs(item.days_remaining) + ' days overdue' : 'Escalated',
    };
  }
  if (item.days_remaining < 0) {
    return {
      badge: <Badge tone="gold">Overdue</Badge>,
      detail: Math.abs(item.days_remaining) + ' days overdue',
    };
  }
  if (item.days_remaining === 0) {
    return {
      badge: <Badge tone="teal">Due today</Badge>,
      detail: 'Due today',
    };
  }
  return {
    badge: <Badge tone="neutral">Open</Badge>,
    detail: 'Due in ' + item.days_remaining + ' days',
  };
}

/* One open action-item card ---------------------------------------------------- */
function OpenItemCard({
  item,
  onDone,
  busy,
}: {
  item: ActionItemView;
  onDone: (id: string) => void;
  busy: boolean;
}) {
  const status = statusFor(item);
  return (
    <div
      className="card"
      style={{
        marginBottom: 12,
        borderColor: item.escalated ? 'var(--red)' : undefined,
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
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{item.title}</div>
          <div style={{ color: 'var(--text2)', fontSize: 14, marginTop: 4 }}>
            Due {fmtDate(item.due_date)} · Escalates {fmtDate(item.escalation_date)} ·{' '}
            {status.detail}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {status.badge}
            {item.flagged_next && <Badge tone="neutral">Flagged for next manager</Badge>}
          </div>
        </div>
        <Button
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => onDone(item.id)}
          aria-label={'Mark done: ' + item.title}
        >
          Mark done
        </Button>
      </div>
    </div>
  );
}

/* Action items: create form + carry-forward open list + done history ----------- */
export default function ActionItems({
  openItems,
  doneItems,
  recentEntries,
}: {
  openItems: ActionItemView[];
  doneItems: ActionItemView[];
  recentEntries: EntryOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(todayLocal());
  const [escalationDays, setEscalationDays] = useState('1');
  const [flaggedNext, setFlaggedNext] = useState(false);
  const [entryId, setEntryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneBusyId, setDoneBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error' | 'info'>('info');

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setToast(null);
    const result = await createActionItem({
      title,
      due_date: dueDate,
      escalation_days: escalationDays,
      flagged_next: flaggedNext,
      shift_entry_id: entryId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle('');
    setDueDate(todayLocal());
    setEscalationDays('1');
    setFlaggedNext(false);
    setEntryId('');
    setToast('Action item added.');
    setToastTone('success');
    router.refresh();
  }

  async function onDone(id: string) {
    setDoneBusyId(id);
    const result = await markActionItemDone(id);
    setDoneBusyId(null);
    if (!result.ok) {
      setToast(result.error);
      setToastTone('error');
      return;
    }
    setToast('Marked done.');
    setToastTone('success');
    router.refresh();
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <Toast message={toast} tone={toastTone} />
      <h2 className="section-title">Action items</h2>

      <Card style={{ marginBottom: 16 }}>
        <h3 className="section-title" style={{ fontSize: 16 }}>
          New action item
        </h3>
        <form onSubmit={onCreate}>
          <Field label="Title" htmlFor="ai-title" error={error}>
            <TextInput
              id="ai-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              maxLength={200}
              required
            />
          </Field>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            <Field label="Due date" htmlFor="ai-due">
              <TextInput
                id="ai-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Escalate after (days past due)" htmlFor="ai-escalation">
              <TextInput
                id="ai-escalation"
                type="number"
                min={0}
                step={1}
                value={escalationDays}
                onChange={(e) => setEscalationDays(e.target.value)}
                required
              />
            </Field>
          </div>
          {recentEntries.length > 0 && (
            <Field label="Link to a log entry (optional)" htmlFor="ai-entry">
              <Select id="ai-entry" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
                <option value="">No link</option>
                {recentEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={flaggedNext}
                onChange={(e) => setFlaggedNext(e.target.checked)}
              />
              Flag for next manager
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add action item'}
            </Button>
          </div>
        </form>
      </Card>

      <h3 className="section-title" style={{ fontSize: 16 }}>
        Open ({openItems.length})
      </h3>
      {openItems.length === 0 ? (
        <p className="empty">No open action items. The slate is clean.</p>
      ) : (
        openItems.map((item) => (
          <OpenItemCard
            key={item.id}
            item={item}
            onDone={onDone}
            busy={doneBusyId === item.id}
          />
        ))
      )}

      {doneItems.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text2)' }}>
            Done ({doneItems.length})
          </summary>
          <div style={{ marginTop: 8 }}>
            {doneItems.map((item) => (
              <div key={item.id} className="card" style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div style={{ color: 'var(--text2)', fontSize: 14, marginTop: 4 }}>
                  Due {fmtDate(item.due_date)}
                  {item.done_at ? ' · Done ' + fmtDateTime(item.done_at) : ''}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Badge tone="green">Done</Badge>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
