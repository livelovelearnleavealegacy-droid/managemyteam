// digest-runner.mjs — shift-log digest sweep.
//
// For every business whose digest_schedule is enabled, compute today's
// scheduled digest time in the business's own timezone. If now is past that
// time and no shift_digests row has been stored for this run yet, call the
// app's POST /api/shift-digest endpoint (CRON-authenticated) so the sweep +
// LLM summarization happens in the web app, where the business logic lives.
//
// Dedupe rule: skip when a shift_digests row exists with period_end >= today's
// local date AND created_at >= today's scheduled instant. That makes the job
// idempotent even if the scheduler fires twice inside the same window.

import { closePool, config, isMain, localParts, log, pool, zonedLocalToUtc } from './config.mjs';

const DEFAULT_SCHEDULE = { enabled: true, time: '18:00', timezone: 'America/Chicago' };

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

async function maybeDigest(business, now) {
  const sched = { ...DEFAULT_SCHEDULE, ...(business.digest_schedule || {}) };
  if (sched.enabled === false) {
    log('digest-runner: skip', business.name, '- digests disabled');
    return 'skipped';
  }
  const parsed = parseTime(sched.time);
  if (!parsed) throw new Error('invalid digest_schedule.time: ' + JSON.stringify(sched.time));
  const tz = sched.timezone || DEFAULT_SCHEDULE.timezone;

  let parts;
  try {
    parts = localParts(now, tz);
  } catch (err) {
    throw new Error('invalid digest_schedule.timezone ' + JSON.stringify(tz) + ': ' + err.message);
  }

  const scheduled = zonedLocalToUtc(tz, parts.year, parts.month, parts.day, parsed.hh, parsed.mm);
  if (now < scheduled) {
    log('digest-runner: skip', business.name, '- not due yet (scheduled ' + scheduled.toISOString() + ')');
    return 'skipped';
  }

  // Already ran today? period_end is a date column; created_at pins the run to this schedule window.
  const existing = await pool.query(
    'select id from shift_digests where business_id = $1 and period_end >= $2 and created_at >= $3 limit 1',
    [business.id, parts.dateStr, scheduled.toISOString()]
  );
  if (existing.rows.length > 0) {
    log('digest-runner: skip', business.name, '- digest already stored for this window');
    return 'skipped';
  }

  const res = await fetch(config.APP_URL + '/api/shift-digest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + config.CRON_SECRET,
    },
    body: JSON.stringify({ business_id: business.id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('POST /api/shift-digest -> HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 300));
  }
  log('digest-runner: digest for', business.name, '->', body && body.digest ? 'stored (' + body.digest.id + ')' : 'null (nothing to summarize)');
  return 'ran';
}

export async function run() {
  const { rows: businesses } = await pool.query('select id, name, digest_schedule from businesses');

  const now = new Date();
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  for (const b of businesses || []) {
    try {
      const outcome = await maybeDigest(b, now);
      if (outcome === 'ran') ran += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      log('digest-runner: ERROR business', b.id, '(' + b.name + ') -', err.message);
    }
  }
  log('digest-runner: done - ran=' + ran + ' skipped=' + skipped + ' failed=' + failed);
  return { ran, skipped, failed };
}

if (isMain()) {
  run()
    .then(() => closePool())
    .catch((err) => {
      log('digest-runner: FATAL -', err.message);
      process.exit(1);
    });
}
