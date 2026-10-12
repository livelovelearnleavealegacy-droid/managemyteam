// config.mjs — environment loading + shared helpers for the worker.
//
// Importing this module validates required env vars immediately and throws a
// clear, actionable error if any are missing. Local job state (dedupe files)
// lives under worker/.state/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REQUIRED = ['APP_URL', 'CRON_SECRET'];

function loadEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k] || !process.env[k].trim());
  if (missing.length > 0) {
    throw new Error(
      'managemyteam-worker: missing required environment variable(s): ' + missing.join(', ') + '\n' +
      'Copy .env.example from the repo root to the environment this worker runs in and fill in the values.'
    );
  }
  const dbUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.trim()) {
    throw new Error(
      'managemyteam-worker: missing required environment variable: DATABASE_OWNER_URL (falls back to DATABASE_URL)\n' +
      'This is the owner-level Postgres connection string; it bypasses RLS for job queries.'
    );
  }
  return {
    APP_URL: String(process.env.APP_URL).replace(/\/+$/, ''),
    DATABASE_URL: dbUrl.trim(),
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY || null,
  };
}

export const config = loadEnv();

// ---- database (Railway-native: owner-level Pool, no RLS, no Supabase) -------
// Single shared Pool; connects as the DB owner (DATABASE_OWNER_URL), which
// bypasses RLS — the same access level the old Supabase service_role key had.
const { Pool } = pg;
export const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on('error', (err) => {
  // An idle client errored in the background; log it instead of crashing the
  // scheduler. Per-query errors still throw to the caller's catch as before.
  console.error('[' + timestamp() + '] managemyteam-worker: idle pg client error -', err.message);
});

export async function closePool() {
  await pool.end();
}

export function timestamp() {
  return new Date().toISOString();
}

export function log(...args) {
  console.log('[' + timestamp() + ']', ...args);
}

// ---- timezone helpers (Intl-based; no deps, no Temporal) --------------------

// Wall-clock components of `date` in the given IANA timezone.
export function localParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday, // e.g. 'Mon'
    dateStr: parts.year + '-' + parts.month + '-' + parts.day, // YYYY-MM-DD
    ymd: [year, month, day],
  };
}

// Convert a wall-clock time in `timeZone` to the matching UTC instant.
export function zonedLocalToUtc(timeZone, year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(guess))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return new Date(guess + (guess - asUtc));
}

// ---- tiny local state store (dedupe across restarts) ------------------------

const workerDir = dirname(fileURLToPath(import.meta.url));
const stateDir = join(workerDir, '.state');

export function readState(name) {
  try {
    return JSON.parse(readFileSync(join(stateDir, name + '.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(name, obj) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, name + '.json'), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// ISO-8601 week key (YYYY-Www) for a Date — used to send the weekly report once.
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// True when this file is executed directly (node digest-runner.mjs etc).
export function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
