function toDate(iso: string): Date {
  // A bare YYYY-MM-DD is parsed at noon local to avoid timezone-day shifts.
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(iso)) {
    return new Date(iso + 'T12:00:00');
  }
  return new Date(iso);
}

/** Today's date in the viewer's local timezone, YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** "Oct 11, 2026" */
export function fmtDate(iso: string): string {
  return toDate(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "6:54 PM" */
export function fmtTime(iso: string): string {
  return toDate(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Oct 11, 2026 6:54 PM" */
export function fmtDateTime(iso: string): string {
  return fmtDate(iso) + ' ' + fmtTime(iso);
}
