// Shared shift-log types and helpers.

export interface ShiftEntry {
  id: string;
  business_id: string;
  user_id: string | null;
  shift_date: string; // YYYY-MM-DD
  body: string;
  source: string;
  linked: Record<string, unknown> | null;
  created_at: string;
  author_name: string | null;
}

/** Raw row from the shift_entries + users(name) join. */
export interface ShiftEntryRow {
  id: string;
  business_id: string;
  user_id: string | null;
  shift_date: string;
  body: string;
  source: string;
  linked: Record<string, unknown> | null;
  created_at: string;
  users: { name: string } | null;
}

export interface ShiftActionItem {
  id: string;
  business_id: string;
  shift_entry_id: string | null;
  title: string;
  due_date: string; // YYYY-MM-DD
  escalation_days: number;
  status: 'open' | 'done';
  done_at: string | null;
  escalated: boolean;
  escalated_at: string | null;
  flagged_next: boolean;
  created_by: string | null;
  created_at: string;
}

/** An action item plus the two values the page derives for display. */
export interface ActionItemView extends ShiftActionItem {
  escalation_date: string; // due_date + escalation_days, YYYY-MM-DD
  days_remaining: number; // due_date minus today; negative = overdue
}

export interface ShiftDigest {
  id: string;
  business_id: string;
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  summary: string;
  source_entry_ids: string[];
  created_at: string;
}

export interface EntryGroup {
  shift_date: string;
  entries: ShiftEntry[];
}

export interface EntryOption {
  id: string;
  label: string;
}

/* Human labels for the shift_entries.source column -------------------------- */
export const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  voice: 'Voice note',
  'auto:task_delinquent': 'Auto: task delinquent',
  'auto:incident_filed': 'Auto: incident filed',
  'auto:timeoff_approved': 'Auto: time off approved',
  'auto:termination': 'Auto: termination',
  'auto:inspection_failed': 'Auto: inspection failed',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Badge tone for a source. Red is reserved for delinquency. */
export function sourceTone(source: string): 'neutral' | 'teal' | 'gold' | 'red' {
  if (source === 'voice') return 'teal';
  if (source === 'auto:task_delinquent') return 'red';
  if (source === 'manual') return 'neutral';
  return 'gold';
}

/* Linked-entry targets -------------------------------------------------------- */
/** Simple section links for auto-log entries. No deep modals in v0.1. */
export interface LinkedTarget {
  href: string;
  label: string;
}

const LINKED_BY_ENTITY: Record<string, LinkedTarget> = {
  incident: { href: '/incidents', label: 'View incident' },
  incident_report: { href: '/incidents', label: 'View incident' },
  task: { href: '/tasks', label: 'View task' },
  task_instance: { href: '/tasks', label: 'View task' },
  time_off: { href: '/time-off', label: 'View time-off request' },
  time_off_request: { href: '/time-off', label: 'View time-off request' },
  inspection: { href: '/inspections', label: 'View inspection' },
  user: { href: '/team', label: 'View team member' },
};

const LINKED_BY_SOURCE: Record<string, LinkedTarget> = {
  'auto:incident_filed': { href: '/incidents', label: 'View incident' },
  'auto:task_delinquent': { href: '/tasks', label: 'View task' },
  'auto:timeoff_approved': { href: '/time-off', label: 'View time-off request' },
  'auto:termination': { href: '/team', label: 'View team member' },
  'auto:inspection_failed': { href: '/inspections', label: 'View inspection' },
};

export function linkedTarget(entry: ShiftEntry): LinkedTarget | null {
  const linked = entry.linked;
  if (linked && typeof linked === 'object' && !Array.isArray(linked)) {
    const entity = (linked as Record<string, unknown>).entity;
    if (typeof entity === 'string' && LINKED_BY_ENTITY[entity]) {
      return LINKED_BY_ENTITY[entity];
    }
  }
  return LINKED_BY_SOURCE[entry.source] ?? null;
}

/* Date helpers (YYYY-MM-DD strings, noon-local math avoids TZ day shifts) ---- */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  const ms = new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime();
  return Math.round(ms / 86400000);
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
