// trial-runner.mjs — trial-expiry notices (pure worker-side, no web/ code).
//
// Daily: find businesses whose trial_ends_at is in the past and which have no
// stripe_subscription_id. Look up the business's active admins, and email
// them "your trial has expired - add a payment method in Settings > Billing".
// Email goes out via the Resend HTTP API directly. If RESEND_API_KEY is not
// set, the email is skipped with a log line (nothing throws).
//
// Dedupe: one notice per business per distinct trial_ends_at value, recorded
// in worker/.state/trial.json, so admins are not emailed every day. If a
// business has no active admins, nothing is marked sent and it retries daily.

import { closePool, config, isMain, log, pool, readState, writeState } from './config.mjs';

const STATE_NAME = 'trial';
const FROM = 'managemyteam <team@managemyteam.io>'; // must match a verified Resend sender domain

function expiryBody(businessName, trialEndsAt) {
  const ended = new Date(trialEndsAt).toISOString().slice(0, 10);
  return (
    'Hi,\n\n' +
    'Your managemyteam trial' + (businessName ? ' for ' + businessName : '') + ' ended on ' + ended + '.\n\n' +
    'To keep your team running, add a payment method in Settings > Billing.\n\n' +
    'Plans are $1 per active employee per month. If you already added a payment method, you can ignore this email.\n\n' +
    '- The managemyteam team\n'
  );
}

async function sendExpiryEmail(admins, businessName, trialEndsAt) {
  if (!config.RESEND_API_KEY) {
    log('trial-runner: RESEND_API_KEY not set - skipping expiry email for', businessName);
    return 'skipped-no-key';
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + config.RESEND_API_KEY,
    },
    body: JSON.stringify({
      from: FROM,
      to: admins.map((a) => a.email),
      subject: 'Your managemyteam trial has expired',
      text: expiryBody(businessName, trialEndsAt),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('Resend API -> HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 300));
  }
  log('trial-runner: expiry email sent for', businessName, 'to', admins.map((a) => a.email).join(', '));
  return 'sent';
}

export async function run() {
  const nowIso = new Date().toISOString();
  const { rows: businesses } = await pool.query(
    'select id, name, trial_ends_at from businesses ' +
    'where trial_ends_at is not null and trial_ends_at < $1 and stripe_subscription_id is null',
    [nowIso]
  );

  const state = readState(STATE_NAME);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const b of businesses || []) {
    try {
      // pg returns timestamptz as a Date; normalize to the ISO string form so
      // the dedupe comparison behaves exactly as before.
      const trialEndsAt = b.trial_ends_at instanceof Date ? b.trial_ends_at.toISOString() : String(b.trial_ends_at);
      if (state[b.id] === trialEndsAt) {
        log('trial-runner: skip', b.name, '- expiry notice already sent for this trial period');
        skipped += 1;
        continue;
      }
      const { rows: admins } = await pool.query(
        "select email, name from users where business_id = $1 and role = 'admin' and terminated_at is null",
        [b.id]
      );
      if (!admins || admins.length === 0) {
        log('trial-runner: WARN', b.name, '- trial expired but business has no active admins; will retry tomorrow');
        skipped += 1;
        continue;
      }
      const outcome = await sendExpiryEmail(admins, b.name, trialEndsAt);
      if (outcome === 'sent') {
        state[b.id] = trialEndsAt;
        writeState(STATE_NAME, state);
        sent += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      log('trial-runner: ERROR business', b.id, '(' + b.name + ') -', err.message);
    }
  }
  log('trial-runner: done - sent=' + sent + ' skipped=' + skipped + ' failed=' + failed);
  return { sent, skipped, failed };
}

if (isMain()) {
  run()
    .then(() => closePool())
    .catch((err) => {
      log('trial-runner: FATAL -', err.message);
      process.exit(1);
    });
}
