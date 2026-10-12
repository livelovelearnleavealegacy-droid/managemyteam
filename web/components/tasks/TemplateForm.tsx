'use client';

/**
 * Task template create/edit form: title, description, checklist (dynamic
 * rows), photo requirement, category, assignment (user or team), recurrence
 * builder, and per-template max-pushes override.
 */
import { useState } from 'react';
import {
  Button,
  Field,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui';
import type { Recurrence } from '@/lib/delinquency';
import {
  createTemplate,
  updateTemplate,
  type TemplateInput,
} from '@/app/(app)/tasks/templates/actions';
import type { TemplateRow, TemplatesData } from './types';

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const MONTHLY_PRESETS: { label: string; days: number[]; months: number[] }[] = [
  { label: 'Monthly', days: [1], months: ALL_MONTHS },
  { label: 'Quarterly', days: [1], months: [1, 4, 7, 10] },
  { label: 'Biannual', days: [1], months: [1, 7] },
  { label: 'Annual', days: [1], months: [1] },
];

function initialRecurrence(r: unknown): Recurrence {
  const rec = r as Recurrence | null | undefined;
  if (rec && rec.kind === 'once' && typeof rec.date === 'string')
    return { kind: 'once', date: rec.date };
  if (rec && rec.kind === 'daily') return { kind: 'daily' };
  if (rec && rec.kind === 'weekly' && Array.isArray(rec.weekdays))
    return { kind: 'weekly', weekdays: rec.weekdays };
  if (
    rec &&
    rec.kind === 'monthly' &&
    Array.isArray(rec.days) &&
    Array.isArray(rec.months)
  )
    return { kind: 'monthly', days: rec.days, months: rec.months };
  return { kind: 'daily' };
}

function toggleNumber(list: number[], n: number): number[] {
  return list.includes(n)
    ? list.filter((x) => x !== n)
    : [...list, n].sort((a, b) => a - b);
}

export default function TemplateForm({
  initial,
  lookups,
  onSaved,
  onCancel,
}: {
  initial?: TemplateRow;
  lookups: Pick<
    TemplatesData,
    'categories' | 'users' | 'teams' | 'businessDefaultMaxPushes'
  >;
  onSaved: (message: string, ok: boolean) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [checklist, setChecklist] = useState<string[]>(
    initial && initial.checklist.length > 0
      ? initial.checklist.map((c) => c.label)
      : []
  );
  const [requirePhoto, setRequirePhoto] = useState(initial?.requirePhoto ?? false);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [assignmentType, setAssignmentType] = useState<'user' | 'team'>(
    initial?.assignmentType ?? 'user'
  );
  const [assignedUserId, setAssignedUserId] = useState(
    initial?.assignedUserId ?? ''
  );
  const [assignedTeamId, setAssignedTeamId] = useState(
    initial?.assignedTeamId ?? ''
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(
    initial ? initialRecurrence(initial.recurrence) : { kind: 'daily' }
  );
  const [maxPushes, setMaxPushes] = useState(
    initial?.maxPushes === null || initial?.maxPushes === undefined
      ? ''
      : String(initial.maxPushes)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeUsers = lookups.users.filter((u) => !u.terminatedAt);

  function setKind(kind: Recurrence['kind']) {
    if (kind === 'once')
      setRecurrence({ kind: 'once', date: '' });
    else if (kind === 'daily') setRecurrence({ kind: 'daily' });
    else if (kind === 'weekly')
      setRecurrence({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5] });
    else setRecurrence({ kind: 'monthly', days: [1], months: ALL_MONTHS });
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const parsedMax =
        maxPushes.trim() === '' ? null : parseInt(maxPushes, 10);
      const input: TemplateInput = {
        title,
        description,
        checklist: checklist
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((label) => ({ label })),
        requirePhoto,
        categoryId: categoryId === '' ? null : categoryId,
        assignmentType,
        assignedUserId:
          assignmentType === 'user' && assignedUserId !== ''
            ? assignedUserId
            : null,
        assignedTeamId:
          assignmentType === 'team' && assignedTeamId !== ''
            ? assignedTeamId
            : null,
        recurrence,
        maxPushes: parsedMax,
      };
      const result = initial
        ? await updateTemplate(initial.id, input)
        : await createTemplate(input);
      onSaved(result.message, result.ok);
      if (!result.ok) setError(result.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg);
      onSaved(msg, false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Field label="Title" htmlFor="tpl-title">
        <TextInput
          id="tpl-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Close out the register"
          maxLength={120}
        />
      </Field>

      <Field label="Description" htmlFor="tpl-description">
        <TextArea
          id="tpl-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What does done look like?"
        />
      </Field>

      <Field label="Checklist (each item must be checked to complete)">
        {checklist.map((label, idx) => (
          <div
            key={idx}
            style={{ display: 'flex', gap: 8, marginBottom: 8 }}
          >
            <TextInput
              value={label}
              onChange={(e) =>
                setChecklist((prev) => {
                  const next = [...prev];
                  next[idx] = e.target.value;
                  return next;
                })
              }
              placeholder={`Step ${idx + 1}`}
              aria-label={`Checklist step ${idx + 1}`}
              maxLength={160}
            />
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                setChecklist((prev) => prev.filter((_, i) => i !== idx))
              }
              aria-label={`Remove checklist step ${idx + 1}`}
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          type="button"
          onClick={() => setChecklist((prev) => [...prev, ''])}
        >
          + Add checklist step
        </Button>
      </Field>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Field label="Category" htmlFor="tpl-category">
          <Select
            id="tpl-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">No category</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Max pushes (override)" htmlFor="tpl-max-pushes">
          <TextInput
            id="tpl-max-pushes"
            type="number"
            min={0}
            step={1}
            value={maxPushes}
            onChange={(e) => setMaxPushes(e.target.value)}
            placeholder={`Business default (${lookups.businessDefaultMaxPushes})`}
            style={{ width: 220 }}
          />
        </Field>
      </div>
      <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: -8 }}>
        Leave empty to follow the business default. A number here is this
        template&apos;s own cap — changing the business default later will not
        change templates that set their own number.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={requirePhoto}
            onChange={(e) => setRequirePhoto(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <span>
            <span className="label">Require completion photo</span>
            <br />
            <span style={{ color: 'var(--text2)', fontSize: 13 }}>
              Staff must attach a photo (resized to 480px) to complete.
            </span>
          </span>
        </label>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
        <legend className="label" style={{ marginBottom: 8 }}>
          Assigned to
        </legend>
        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="assignment"
              checked={assignmentType === 'user'}
              onChange={() => setAssignmentType('user')}
            />
            Specific user
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="assignment"
              checked={assignmentType === 'team'}
              onChange={() => setAssignmentType('team')}
            />
            Whole team
          </label>
        </div>
        {assignmentType === 'user' ? (
          <Select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            aria-label="Assigned user"
          >
            <option value="">Choose a user…</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </Select>
        ) : (
          <Select
            value={assignedTeamId}
            onChange={(e) => setAssignedTeamId(e.target.value)}
            aria-label="Assigned team"
          >
            <option value="">Choose a team…</option>
            {lookups.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.memberCount}{' '}
                {t.memberCount === 1 ? 'member' : 'members'})
              </option>
            ))}
          </Select>
        )}
        {assignmentType === 'team' && (
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>
            Instances follow current team membership — if someone leaves the
            team, its tasks leave their board.
          </p>
        )}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
        <legend className="label" style={{ marginBottom: 8 }}>
          Repeats
        </legend>
        <Select
          value={recurrence.kind}
          onChange={(e) => setKind(e.target.value as Recurrence['kind'])}
          aria-label="Recurrence kind"
          style={{ marginBottom: 12 }}
        >
          <option value="once">Once</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </Select>

        {recurrence.kind === 'once' && (
          <TextInput
            type="date"
            value={recurrence.date}
            onChange={(e) =>
              setRecurrence({ kind: 'once', date: e.target.value })
            }
            aria-label="One-time date"
          />
        )}

        {recurrence.kind === 'weekly' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((d) => (
              <label
                key={d.value}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  cursor: 'pointer',
                  padding: '6px 10px',
                  border: '1px solid var(--panel2)',
                  borderRadius: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={recurrence.weekdays.includes(d.value)}
                  onChange={() =>
                    setRecurrence({
                      kind: 'weekly',
                      weekdays: toggleNumber(recurrence.weekdays, d.value),
                    })
                  }
                />
                {d.label}
              </label>
            ))}
          </div>
        )}

        {recurrence.kind === 'monthly' && (
          <div>
            <div style={{ marginBottom: 10 }}>
              <span className="label">Presets</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {MONTHLY_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant="ghost"
                    type="button"
                    onClick={() =>
                      setRecurrence({
                        kind: 'monthly',
                        days: p.days,
                        months: p.months,
                      })
                    }
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <span className="label">Days of month</span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
                gap: 6,
                margin: '6px 0 12px',
              }}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <label
                  key={day}
                  style={{
                    display: 'flex',
                    gap: 4,
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={recurrence.days.includes(day)}
                    onChange={() =>
                      setRecurrence({
                        kind: 'monthly',
                        days: toggleNumber(recurrence.days, day),
                        months: recurrence.months,
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            <span className="label">Months</span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                gap: 6,
                marginTop: 6,
              }}
            >
              {MONTHS.map((name, idx) => (
                <label
                  key={name}
                  style={{
                    display: 'flex',
                    gap: 4,
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={recurrence.months.includes(idx + 1)}
                    onChange={() =>
                      setRecurrence({
                        kind: 'monthly',
                        days: recurrence.days,
                        months: toggleNumber(recurrence.months, idx + 1),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <p style={{ color: 'var(--text2)', fontSize: 13 }}>
              Days past the end of a short month land on that month&apos;s
              last day (e.g. the 31st → Feb 28).
            </p>
          </div>
        )}
      </fieldset>

      {error && (
        <p role="status" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create template'}
        </Button>
      </div>
    </div>
  );
}
