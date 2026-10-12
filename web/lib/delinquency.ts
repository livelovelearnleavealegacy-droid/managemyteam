/**
 * managemyteam.io — delinquency engine (CORE IP).
 *
 * Pure functions implementing the push-to-tomorrow delinquency algorithm.
 * Ported faithfully from the reference implementation (team-ops.jsx):
 *
 *   - Every task instance has an originalDate and a pushCount.
 *   - Pushing moves the effective due date forward one day (originalDate +
 *     pushCount days); a hard cap (maxPushes) bounds the number of pushes.
 *   - Once pushes are exhausted and the effective date is past, the instance
 *     is DELINQUENT (red) — never silently carried forever.
 *
 * Status evaluation order is significant and exact:
 *   completed → delinquent → overdue → due-today → upcoming
 *
 * All date math operates on YYYY-MM-DD strings parsed at noon local time
 * (the lib/format.ts approach) so timezone shifts never move a date by a day.
 */

export type TaskStatus =
  | 'completed'
  | 'delinquent'
  | 'overdue'
  | 'due-today'
  | 'upcoming';

export type Recurrence =
  | { kind: 'once'; date: string }
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'monthly'; days: number[]; months: number[] };

/** Parse a YYYY-MM-DD string at noon local to avoid timezone-day shifts. */
function parseDay(iso: string): Date {
  return new Date(iso + 'T12:00:00');
}

/** Format a Date back to YYYY-MM-DD in local time. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Canonical instance key: `${templateId}_${originalDate}`.
 * Template ids are UUIDs (no underscores), so the split is unambiguous.
 */
export function instanceKey(templateId: string, originalDate: string): string {
  return `${templateId}_${originalDate}`;
}

/** Effective due date = originalDate + pushCount days, as YYYY-MM-DD. */
export function effectiveDate(originalDate: string, pushCount: number): string {
  const d = parseDay(originalDate);
  d.setDate(d.getDate() + pushCount);
  return toISODate(d);
}

/** Per-template max_pushes override wins; NULL falls back to the business default. */
export function resolveMaxPushes(
  templateMaxPushes: number | null,
  businessDefault: number
): number {
  return templateMaxPushes === null || templateMaxPushes === undefined
    ? businessDefault
    : templateMaxPushes;
}

export function computeStatus(
  args: {
    originalDate: string;
    pushCount: number;
    maxPushes: number;
    completed: boolean;
  },
  todayISO: string
): TaskStatus {
  const eff = effectiveDate(args.originalDate, args.pushCount);

  // Evaluation order is exact — do not reorder.
  if (args.completed) return 'completed';
  if (eff < todayISO && args.pushCount >= args.maxPushes) return 'delinquent';
  if (eff < todayISO) return 'overdue';
  if (eff === todayISO) return 'due-today';
  return 'upcoming';
}

/**
 * Next push count, or null when pushing is disabled.
 * Push is disabled exactly at the limit: pushCount >= maxPushes.
 * (A business default of 0 means "pushing disabled" for templates without
 * an override; a template-level max_pushes of 0 likewise disables pushing.)
 */
export function tryPush(pushCount: number, maxPushes: number): number | null {
  if (pushCount >= maxPushes) return null;
  return pushCount + 1;
}
