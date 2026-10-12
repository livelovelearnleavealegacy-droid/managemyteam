// index.mjs — tiny scheduler for the managemyteam.io worker.
//
// Run with: node worker/index.mjs   (from the repo root)
// or:       npm start               (from the worker/ directory)
//
// Schedule:
//   - digest-runner : every 15 minutes (self-skips unless a business's
//                     scheduled digest time has passed and no digest exists)
//   - report-runner : every hour (self-checks "is it Monday 08:00+ business
//                     time" per business, dedupes one send per ISO week)
//   - trial-runner  : every 24 hours (sends trial-expiry notices)
//
// Each job also runs once at startup so a fresh deploy does not wait a full
// interval. All logging goes to stdout with ISO timestamps. A single job
// failure is logged and never crashes the scheduler.

import { log } from './config.mjs';
import { run as runDigest } from './digest-runner.mjs';
import { run as runReports } from './report-runner.mjs';
import { run as runTrial } from './trial-runner.mjs';

const MINUTE = 60 * 1000;

function every(intervalMs, name, fn) {
  const tick = async () => {
    try {
      log('scheduler:', name, 'starting');
      await fn();
    } catch (err) {
      log('scheduler:', name, 'FAILED -', err.message);
    }
  };
  tick(); // run once immediately at startup
  setInterval(tick, intervalMs);
  return tick;
}

log('managemyteam-worker starting (node ' + process.version + ')');
every(15 * MINUTE, 'digest-runner', runDigest);
every(60 * MINUTE, 'report-runner', runReports);
every(24 * 60 * MINUTE, 'trial-runner', runTrial);
log('scheduler: digest every 15m, reports hourly, trial every 24h');

const shutdown = (signal) => {
  log('scheduler: received ' + signal + ', exiting');
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
