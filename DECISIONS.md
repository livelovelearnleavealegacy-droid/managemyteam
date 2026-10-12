# DECISIONS.md — managemyteam.io Railway-native build (v0.1)

Every interpretive choice made while porting the Supabase v0.1 to
GitHub + Railway with plain Postgres. One line each, grouped by area.

## Auth & database access

1. RLS is enforced through a Postgres session var: every app request runs
   inside `withUser()` on a single `pg` client that does `BEGIN`,
   `SET LOCAL app.current_user_id = $1`, then its queries — policies read
   `current_setting('app.current_user_id')`, never a Supabase JWT claim.
2. The web app connects as the **non-owner role `app_user`** (created +
   granted by `scripts/migrate.mjs`); `app_user` owns nothing, so RLS
   applies to every app query by construction.
3. A second **owner pool** (`DATABASE_OWNER_URL`, the Postgres plugin's
   owner string) bypasses RLS and is used only for: migrations, the seed
   script, signup inserts, and service-level reads like billing counts.
4. Auth.js v5 uses the **Credentials provider with JWT sessions** — no
   adapter tables, no `next-auth` schema; identity is just the
   `password_hash` column on `public.users`, verified with bcryptjs.
5. Demo/seed passwords are hashed with **bcrypt 12 rounds**, matching the
   app's own signup hash cost so verification behaves identically.
6. `getActiveCount()` runs on the owner pool (service-level billing read)
   with an explicit `business_id` filter — no user session required, so the
   webhook route and checkout flow share one implementation.
7. `pg` pools are built behind a **lazy proxy** so importing `lib/db.ts`
   from Edge-runtime middleware never instantiates a pool (the `authorized`
   callback is pure); real pools are constructed on first actual query.

## Photos

8. Task photos are served and uploaded through **authenticated API routes**
   (`/api/photos`, `/api/photos/[...path]`) backed by a filesystem
   directory (`PHOTOS_DIR`, default `/data/photos`) on a Railway **volume**,
   instead of Supabase Storage signed URLs.
9. Uploads are **immutable** in v0.1: uploading to an existing path returns
   409, so no object is ever silently overwritten.

## Worker

10. The worker is a **separate Railway service** (root directory `worker/`,
    start command `node index.mjs`), not pg_cron and not an Edge Function —
    a plain Node scheduler that calls the web app's own API routes, so all
    business logic lives in one place.
11. Scheduled endpoints (`/api/shift-digest`, `/api/reports/email`) are
    protected by a shared **`CRON_SECRET` Bearer <redacted>** instead of Supabase's
    service-role key; the same value must be set on both services.
12. Trial-expiry notices are **pure worker-side via the Resend API**; the
    worker's DB pool connects as the owner (the old `service_role`
    equivalent).

## Docker & deploy

13. The web image is a **multi-stage Dockerfile** (deps → builder →
    runner); only `node_modules`, `.next`, and `public/` reach the runner,
    keeping restarts fast.
14. The Dockerfile deliberately uses **default `next start` output** —
    `web/next.config.mjs` sets no `output: 'standalone'`, so it was left
    alone rather than "fixed".
15. `next build` runs with **dummy build-time envs** (documented in the
    Dockerfile); real secrets come from the Railway service env at runtime
    and are never baked into the image.
16. The runner starts with `next start -p ${PORT:-3000}` in CMD shell form
    so **Railway's injected `PORT`** is honored (3000 fallback locally).
17. `railway.json` configures only the web service's Dockerfile build; the
    worker service is configured in the Railway UI (root `worker/`), which
    is documented in the README rather than encoded in JSON.

## Data handling

18. Sequential queries that must share one transaction run **inside a
    single `withUser()` block on one `pg` client** (no parallel pooled
    queries mid-transaction), because `SET LOCAL` is per-connection.
19. **Timestamps are normalized to ISO strings at the `pg` boundary**
    (e.g. `new Date(row.trial_ends_at).toISOString()`) before leaving
    server code, so JSON responses are stable regardless of driver date
    parsing.
20. The seed migration inserts the demo *business* data, but demo *users*
    live in `scripts/seed-users.mjs` — credential identity (bcrypt hashes)
    is outside what SQL migrations should own.
21. `seed-users.mjs` looks the business up **by name, newest wins**, and
    skips existing emails — idempotent and safe to re-run.
22. The migration runner does **not** track applied files; it re-applies all
    4 files per run (schema is safe, the seed migration is append-only —
    documented in README Known limits).
23. Migration `2026101104_additions.sql` holds every schema addition that
    wasn't in the base port, keeping the original three files untouched.

## Verification limits (this build)

24. No live Postgres or Docker was available in the build environment:
    `tsc --noEmit` (zero errors), `node --check`, the Supabase/TODO greps,
    migration balance/`auth.*` checks, and the `cmp` of
    `web/lib/delinquency.ts` against the Supabase v0.1 all passed, but the
    Dockerfile was not built and migrations/seed were not executed.
25. **Two-business isolation has not been proven on a live database** —
    required before production use (README Known limits).
26. Stripe, Resend, and Anthropic integrations are **untested live**;
    test-mode runs (README Steps 7–8) are required before charging anyone.
27. `delinquency.ts` is byte-identical to the Supabase v0.1 file, so the 24
    delinquency edge cases verified against that shared logic carry over
    unchanged.
