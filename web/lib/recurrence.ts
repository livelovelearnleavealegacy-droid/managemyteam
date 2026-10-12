/**
 * managemyteam.io — recurrence expansion.
 *
 * Turns a task template's recurrence rule into concrete dated instances
 * inside a query window [fromISO, toISO] (both inclusive).
 *
 * Notes:
 *   - weekly has NO start bound in v0.1 (the recurrence JSON carries no
 *     start date), so weekly instances expand from the window start. When a
 *     start bound is added later, pass it in and clamp the expansion.
 *   - monthly days 1–31 are clamped to the last day of shorter months
 *     (e.g. day 31 → Feb 28/29). Duplicated or out-of-range days are
 *     deduplicated/ignored, never dropped.
 */
import type { Recurrence } from './delinquency';
import { instanceKey } from './delinquency';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseDay(iso: string): Date {
  return new Date(iso + 'T12:00:00');
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

export interface ExpandedInstance {
  instanceKey: string;
  originalDate: string;
}

export function expandInstances(
  t: { id: string; recurrence: Recurrence },
  fromISO: string,
  toISO: string
): ExpandedInstance[] {
  const r = t.recurrence;
  const out: ExpandedInstance[] = [];
  const emit = (originalDate: string) => {
    if (originalDate >= fromISO && originalDate <= toISO) {
      out.push({ instanceKey: instanceKey(t.id, originalDate), originalDate });
    }
  };

  if (r.kind === 'once') {
    emit(r.date);
  } else if (r.kind === 'daily') {
    const d = parseDay(fromISO);
    const end = toISO;
    while (toISODate(d) <= end) {
      emit(toISODate(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (r.kind === 'weekly') {
    const wanted = new Set(
      (r.weekdays ?? []).filter((w) => Number.isInteger(w) && w >= 0 && w <= 6)
    );
    const d = parseDay(fromISO);
    while (toISODate(d) <= toISO) {
      if (wanted.has(d.getDay())) emit(toISODate(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (r.kind === 'monthly') {
    const days = Array.from(
      new Set(
        (r.days ?? []).filter(
          (n) => Number.isInteger(n) && n >= 1 && n <= 31
        )
      )
    ).sort((a, b) => a - b);
    const months = new Set(
      (r.months ?? []).filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= 12
      )
    );
    // Walk each month spanned by the window; generate one date per (month, day).
    const cursor = parseDay(fromISO);
    cursor.setDate(1);
    while (toISODate(cursor) <= toISO) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      if (months.has(month)) {
        const last = daysInMonth(year, month);
        for (const day of days) {
          const clamped = Math.min(day, last); // e.g. 31 → Feb 28/29
          const d = new Date(year, month - 1, clamped, 12, 0, 0);
          emit(toISODate(d));
        }
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // Chronological, and dedupe defensively (e.g. duplicate days in monthly).
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.originalDate.localeCompare(b.originalDate))
    .filter((i) => {
      if (seen.has(i.instanceKey)) return false;
      seen.add(i.instanceKey);
      return true;
    });
}

/**
 * Human-readable recurrence summary.
 * Examples: "Daily" · "Weekly · Mon, Wed" ·
 * "Monthly · day 15 (Jan, Apr, Jul, Oct)" · "Once · 2026-11-01"
 */
export function describeRecurrence(r: Recurrence): string {
  if (r.kind === 'once') return `Once · ${r.date}`;
  if (r.kind === 'daily') return 'Daily';
  if (r.kind === 'weekly') {
    const names = (r.weekdays ?? [])
      .filter((w) => Number.isInteger(w) && w >= 0 && w <= 6)
      .sort((a, b) => a - b)
      .map((w) => WEEKDAY_NAMES[w]);
    return names.length > 0 ? `Weekly · ${names.join(', ')}` : 'Weekly';
  }
  // monthly
  const days = Array.from(
    new Set(
      (r.days ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
    )
  ).sort((a, b) => a - b);
  const months = (r.months ?? [])
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
    .sort((a, b) => a - b)
    .map((m) => MONTH_NAMES[m - 1]);
  const dayPart =
    days.length === 0 ? '' : days.length === 1 ? `day ${days[0]}` : `days ${days.join(', ')}`;
  const monthPart = months.length > 0 ? ` (${months.join(', ')})` : '';
  return `Monthly${dayPart ? ' · ' + dayPart : ''}${monthPart}`;
}
