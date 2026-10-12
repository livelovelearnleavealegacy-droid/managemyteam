// ============================================================================
// managemyteam.io — demo user seeder (Railway Postgres build).
//
// Inserts the three demo login accounts (admin / manager / staff) for the
// seeded demo business "Maple Street Diner" (db/migrations/2026101103_seed.sql),
// storing each password as a bcryptjs hash with 12 rounds (the same rounds
// the app's own signup uses, so Auth.js credential verification works).
//
// Run AFTER the migrations (npm run migrate). The connection must be the
// database OWNER (DATABASE_OWNER_URL), which bypasses RLS — the same access
// level the migration runner uses.
//
//   cd scripts && npm install
//   DATABASE_OWNER_URL='postgres://postgres:<pw>@<host>:<port>/railway' npm run seed-users
//
// DATABASE_OWNER_URL falls back to DATABASE_URL when unset (with a warning).
//
// Idempotent: each demo email is looked up first and skipped when present, so
// the script is safe to re-run. The business is looked up by name
// ('Maple Street Diner'); if the seed migration was applied twice there are
// duplicates, and the most recently created row wins.
//
// Every seeded user shares the password:  demo1234!
// ============================================================================

import pg from 'pg';
import bcrypt from 'bcryptjs';

const DEMO_PASSWORD = 'demo1234!';
const BCRYPT_ROUNDS = 12;
const BUSINESS_NAME = 'Maple Street Diner';

const USERS = [
  { email: 'admin@maple.local',   name: 'Maple Admin',   role: 'admin' },
  { email: 'manager@maple.local', name: 'Maple Manager', role: 'manager' },
  { email: 'staff@maple.local',   name: 'Maple Staff',   role: 'staff' },
];

async function main() {
  const ownerUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error('ERROR: set DATABASE_OWNER_URL (or DATABASE_URL) to the owner connection string.');
    process.exit(1);
  }
  if (process.env.DATABASE_OWNER_URL) {
    console.log('Using DATABASE_OWNER_URL (owner — bypasses RLS).');
  } else {
    console.log('WARNING: DATABASE_OWNER_URL not set; falling back to DATABASE_URL. ' +
      'Seed as the owner so RLS is bypassed.');
  }

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select id, name
         from public.businesses
        where name = $1
        order by created_at desc
        limit 1`,
      [BUSINESS_NAME]
    );
    if (rows.length === 0) {
      console.error(
        `ERROR: no business named '${BUSINESS_NAME}' found. ` +
        `Run the migrations first (npm run migrate), then seed users.`
      );
      process.exit(1);
    }
    const business = rows[0];
    console.log(`Demo business: '${business.name}' (id ${business.id})`);

    const hash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
    console.log('Password hashed with bcrypt (12 rounds).');

    let created = 0;
    let skipped = 0;
    for (const u of USERS) {
      const existing = await client.query(
        `select id from public.users where business_id = $1 and email = $2`,
        [business.id, u.email]
      );
      if (existing.rows.length > 0) {
        console.log(`  SKIP    ${u.email} (already exists)`);
        skipped++;
        continue;
      }
      await client.query(
        `insert into public.users (business_id, email, name, password_hash, role)
         values ($1, $2, $3, $4, $5)`,
        [business.id, u.email, u.name, hash, u.role]
      );
      console.log(`  CREATED ${u.email}  role=${u.role}`);
      created++;
    }

    console.log(`Done: ${created} created, ${skipped} skipped.`);
    console.log(`Sign in at the app's /login with any of the above; password is '${DEMO_PASSWORD}'.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
