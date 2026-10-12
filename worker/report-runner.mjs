// report-runner.mjs — weekly report email sweep.
//
// The scheduler fires this hourly. For each real business (has a
// stripe_subscription_id OR a trial configured) it checks the business-local
// clock: if it is Monday and 08:00 local has passed, it calls the app's
// POST /api/reports/email endpoint (CRON-authenticated), which composes and
// sends the weekly report to the business's admins.
//
// The app has no "reports sent" table in v0.1, so the worker dedupes locally:
// one send per business per ISO week, recorded in worker/.state/reports.json.
// If the 08:00 tick is missed (worker was down), the next hourly tick on the
// same Monday still sends — "Monday ~08:00 business-local", not exactly 08:00.

import { closePool, config, isMain, isoWeekKey, localParts, log, pool, readState, writeState } from './config.mjs';

const STATE_NAME = 'reports';
const REPORT_DAY = 'Mon';
const REPORT_HOUR = 8;

async function maybeSend(business, now) {
  const tz = (business.digest_schedule && business.digest_schedule.timezone) || 'America/Chicago';
  let parts;
  try {
    parts = localParts(now, tz);
  } catch (err) {
    throw new Error('invalid timezone ' + JSON.stringify(tz) + ': ' + err.message);
  }

  if (parts.weekday !== REPORT_DAY || parts.hour < REPORT_HOUR) {
    return 'skipped'; // not Monday 08:00+ business-local yet
  }

  const week = isoWeekKey(now);
  const state = readState(STATE_NAME);
  if (state[business.id] === week) {
    log('report-runner: skip', business.name, '- weekly report already sent for', week);
    return 'skipped';
  }

  const res = await fetch(config.APP_URL + '/api/reports/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + config.CRON_SECRET,
    },
    body: JSON.stringify({ business_id: business.id, range: 'week' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('POST /api/reports/email -> HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 300));
  }
  const sent = body && typeof body.sent === 'number' ? body.sent : '?';
  const skippedCount = body && typeof body.skipped === 'number' ? body.skipped : '?';
  log('report-runner: weekly report for', business.name, '-> sent=' + sent + ' skipped=' + skippedCount);

  state[business.id] = week;
  writeState(STATE_NAME, state);
  return 'ran';
}

export async function run() {
  // All real businesses: paying subscribers OR trials (trial_ends_at set).
  const { rows: businesses } = await pool.query(
    'select id, name, digest_schedule, stripe_subscription_id, trial_ends_at ' +
    'from businesses where stripe_subscription_id is not null or trial_ends_at is not null'
  );

  const now = new Date();
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  for (const b of businesses || []) {
    try {
      const outcome = await maybeSend(b, now);
      if (outcome === 'ran') ran += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      log('report-runner: ERROR business', b.id, '(' + b.name + ') -', err.message);
    }
  }
  log('report-runner: done - ran=' + ran + ' skipped=' + skipped + ' failed=' + failed);
  return { ran, skipped, failed };
}

if (isMain()) {
  run()
    .then(() => closePool())
    .catch((err) => {
      log('report-runner: FATAL -', err.message);
      process.exit(1);
    });
}
