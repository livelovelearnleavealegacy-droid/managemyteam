// ============================================================================
// managemyteam.io — Railway Postgres migration runner.
//
// Usage (from repo root):
//   APP_DB_PASSWORD='<strong-password>' \
//   DATABASE_OWNER_URL='postgres://postgres:<pw>@<host>:<port>/railway' \
//     node scripts/migrate.mjs
//
// DATABASE_OWNER_URL falls back to DATABASE_URL when unset.
// On Railway, the plugin's DATABASE_URL connects as the database OWNER
// (postgres), which is what this script needs: CREATE ROLE, GRANT, DDL, and
// migrations must run as the owner. The app itself connects as the NON-OWNER
// role app_user (password from APP_DB_PASSWORD) so RLS applies.
//
// Steps:
//   1. Apply db/migrations/*.sql in filename order, one transaction per
//      file, SKIPPING files already recorded in public.schema_migrations.
//      Applied files are recorded in the same transaction as their DDL, so
//      container restarts are safe: the SQL files use plain CREATE TABLE /
//      CREATE POLICY and are NOT re-runnable against an existing database.
//      Legacy bootstrap: a database that was migrated before tracking
//      existed (tables present, zero history rows) gets every current file
//      recorded as applied without executing it.
//   2. CREATE ROLE IF NOT EXISTS app_user LOGIN PASSWORD '<APP_DB_PASSWORD>'
//      (password is refreshed on every run so it stays in sync with the env)
//   3. Grants: CONNECT, USAGE on schemas public/app, full DML on all tables
//      in public, USAGE+SELECT on all sequences, EXECUTE on app functions,
//      plus ALTER DEFAULT PRIVILEGES so future tables/sequences get the same.
//   4. Verify: every one of the 21 tables must exist with RLS enabled;
//      exit non-zero listing offenders otherwise.
// ============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

// The 21 tables this project owns. The verification step fails the run if any
// of these is missing or has RLS disabled.
const EXPECTED_TABLES = [
  'businesses',
  'users',
  'teams',
  'team_members',
  'categories',
  'task_templates',
  'task_instance_state',
  'task_completions',
  'shift_entries',
  'shift_action_items',
  'shift_digests',
  'chat_messages',
  'announcements',
  'kudos',
  'knowledge_articles',
  'shifts',
  'time_clock_entries',
  'incident_reports',
  'inspections',
  'time_off_requests',
  'stripe_events',
];

const ownerUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error('ERROR: set DATABASE_OWNER_URL (or DATABASE_URL) to the owner connection string.');
  process.exit(1);
}
const appPassword = process.env.APP_DB_PASSWORD;
if (!appPassword) {
  console.error('ERROR: set APP_DB_PASSWORD to the password for the app_user role.');
  process.exit(1);
}

// Quote a string literal safely (single-quote doubling).
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Quote an identifier safely (double-quote doubling).
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

function dbNameFromUrl(url) {
  try {
    const name = new URL(url).pathname.replace(/^\//, '');
    if (!name) throw new Error('empty database name');
    return name;
  } catch (err) {
    console.error(`ERROR: could not parse database name from connection URL: ${err.message}`);
    process.exit(1);
  }
}

async function ensureAppUser(client) {
  console.log('Ensuring role app_user exists (and password is current)...');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD ${lit(appPassword)};
      ELSE
        ALTER ROLE app_user WITH LOGIN PASSWORD ${lit(appPassword)};
      END IF;
    END
    $$;`);

  const dbName = dbNameFromUrl(ownerUrl);
  console.log(`Granting app_user access (database ${dbName})...`);
  await client.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO app_user;`);
  await client.query(`GRANT USAGE ON SCHEMA public TO app_user;`);
  await client.query(`GRANT USAGE ON SCHEMA app TO app_user;`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;`);
  // Future objects created by the owner get the same privileges automatically.
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO app_user;`);
  console.log('Grants applied.');
}

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigrations(client) {
  const files = migrationFiles();
  if (files.length === 0) {
    console.error(`ERROR: no .sql files found in ${migrationsDir}`);
    process.exit(1);
  }

  // Bookkeeping table: which migration files have already been applied.
  // Created by the runner itself (not by a migration file) so it exists
  // before the first file runs.
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );`);

  const { rows } = await client.query('SELECT name FROM public.schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  // Legacy bootstrap: databases migrated before tracking existed have the
  // tables but no history rows. Re-running the files would fail on existing
  // objects, so record every current file as applied instead.
  if (applied.size === 0) {
    const { rows: probe } = await client.query(
      `SELECT to_regclass('public.businesses') AS businesses`);
    if (probe[0].businesses !== null) {
      console.log(
        'Existing database detected with no migration history; ' +
        'recording all current migrations as applied without re-running them.');
      for (const file of files) {
        await client.query(
          'INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [file]);
        applied.add(file);
      }
    }
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied).`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`Applying ${file} ...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      // Record in the SAME transaction: a failed file is never marked.
      await client.query(
        'INSERT INTO public.schema_migrations (name) VALUES ($1)',
        [file]);
      await client.query('COMMIT');
      console.log(`  ok`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAILED applying ${file}: ${err.message}`);
      process.exit(1);
    }
  }
}

async function verifyRls(client) {
  const { rows } = await client.query(
    `select c.relname as name, c.relrowsecurity as rls
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname = any ($1)`,
    [EXPECTED_TABLES]);

  const byName = new Map(rows.map((r) => [r.name, r.rls]));
  const offenders = EXPECTED_TABLES.filter((t) => byName.get(t) !== true);
  if (offenders.length > 0) {
    const missing = EXPECTED_TABLES.filter((t) => !byName.has(t));
    const noRls = offenders.filter((t) => !missing.includes(t));
    console.error('VERIFICATION FAILED:');
    if (missing.length > 0) console.error(`  missing tables: ${missing.join(', ')}`);
    if (noRls.length > 0) console.error(`  RLS not enabled: ${noRls.join(', ')}`);
    process.exit(1);
  }
  console.log(`Verification passed: all ${EXPECTED_TABLES.length} tables exist with RLS enabled.`);
}

async function main() {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // Migrations FIRST: they create the app schema and tables. Grants come
    // after so GRANT ... ON SCHEMA app / ON ALL TABLES IN SCHEMA public
    // don't fail on a fresh database where those objects don't exist yet.
    await applyMigrations(client);
    await ensureAppUser(client);
    await verifyRls(client);
    console.log('Migration complete.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
