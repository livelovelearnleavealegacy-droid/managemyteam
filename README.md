# managemyteam.io — Railway-native build (v0.1)

A staff task-accountability web app for 5–50 employee businesses: task boards
with push-to-tomorrow delinquency limits, scheduling, time clock, shift log
with LLM digest, reports, billing at **$1 per active employee per month**, and
a 14-day free trial — no card required.

**This is the Railway-native port.** It runs on **GitHub + Railway only** —
no Supabase, no external auth provider, no Edge Functions. Plain Postgres
(Railway plugin), Auth.js v5 credentials auth against Postgres, a plain Node
worker for background jobs. Feature-identical to the Supabase v0.1 build:
same pages, same API routes, same delinquency rules, same pricing.

Repo layout:

```
managemyteam-io-railway/
  Dockerfile            # web service image (multi-stage)
  railway.json          # web service build config (Dockerfile)
  .env.example          # every env var, commented
  DECISIONS.md          # interpretive choices made in this port
  README.md             # this file
  db/
    migrations/         # 4 SQL files, applied in filename order
  scripts/
    package.json        # npm install; `npm run migrate`, `npm run seed-users`
    migrate.mjs         # creates app_user, applies migrations, verifies RLS
    seed-users.mjs      # inserts the 3 demo login accounts
  web/                  # Next.js 14 app (Auth.js v5, pg driver)
  worker/               # background jobs: digest sweep, report emails, trials
```

---

## Prerequisites

1. A **GitHub account**.
2. A **Railway account** (connect it to your GitHub).
3. A **Stripe account in test mode** (dashboard toggle: Test mode ON).
4. **Node 20+** on your own machine, for running the one-off scripts
   (`node -v` should print `v20.x` or higher). You do *not* need Docker.

---

## Step 1 — Push this repo to GitHub

From the repo root on your machine:

```bash
git init
git add .
git commit -m "managemyteam.io Railway-native v0.1"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/managemyteam-io-railway.git
git push -u origin main
```

Replace `YOUR-GITHUB-USERNAME` with your GitHub username. If you haven't
created the repo on GitHub yet, create an empty repo named
`managemyteam-io-railway` first (no README, no .gitignore — this folder
already has what it needs), then run the commands above.

---

## Step 2 — Create the Railway project and services

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy
   from GitHub repo** → choose `managemyteam-io-railway`. Railway reads
   `railway.json` at the repo root and builds the **web service** with the
   Dockerfile automatically.

2. **Add Postgres:** in the project canvas click **+ New** → **Database** →
   **PostgreSQL**. Railway creates the plugin and exposes its connection
   string as the plugin's `DATABASE_URL` variable (this connects as the
   database *owner*, `postgres` — the scripts and the app's owner pool use
   it; the app's day-to-day queries use a separate non-owner role,
   `app_user`, created in Step 4).

3. **Add the photos volume** (web service only): select the web service →
   **Volumes** → **+ New Volume** → set **Mount Path** to `/data/photos`.
   Task photos are stored on the web service's filesystem; without the
   volume they are wiped on every redeploy. The app reads the directory
   from the `PHOTOS_DIR` env var (default `/data/photos`).

4. **Add the worker as a second service:** **+ New** → **GitHub Repo** →
   choose `managemyteam-io-railway` *again* (a second service from the same
   repo is fine). In the new service's **Settings**:
   - **Root Directory** → `worker`
   - **Build Command** → `npm install` (Railway's Nixpacks default handles
     this; the worker has no Dockerfile — it needs only Node + `pg`)
   - **Start Command** → `node index.mjs`
   - Give it a distinct name, e.g. `managemyteam-worker`.

   The worker is a plain Node scheduler (see `worker/WORKER.md`): it calls
   the web app's own API routes every 15 minutes (shift-log digest sweep),
   hourly (weekly report emails), and daily (trial-expiry notices). Business
   logic lives in the web app; the worker is just a timer.

---

## Step 3 — Environment variables

Open `.env.example` at the repo root for the full commented reference. Set
variables in each Railway service's **Variables** tab.

| Variable | Which service | Where the value comes from |
|---|---|---|
| `DATABASE_URL` | web | **App_user** connection string (non-owner — this is what RLS enforces). Take the Postgres plugin's `DATABASE_URL` and change the userinfo to `app_user:<APP_DB_PASSWORD>`: `postgres://app_user:<APP_DB_PASSWORD>@<host>:<port>/railway`. |
| `DATABASE_OWNER_URL` | web, worker, local scripts | Owner connection string = the Postgres plugin's `DATABASE_URL` verbatim. In Railway, set it as a variable reference: `${{Postgres.DATABASE_URL}}` (match your plugin's name). Bypasses RLS; used by migrations, seed script, signup, and the worker. |
| `APP_DB_PASSWORD` | **local only** (your shell) | Generate: `openssl rand -base64 24`. Passed to the migration runner in Step 4; the runner sets it as the `app_user` password, and you put the same value into the web service's `DATABASE_URL`. |
| `AUTH_SECRET` | web | `openssl rand -hex 32` |
| `AUTH_URL` | web | Public URL of the web service, e.g. `https://your-app.up.railway.app` (Settings → Networking → Generate Domain) |
| `PHOTOS_DIR` | web | `/data/photos` (matches the volume mount; this is also the app's default) |
| `STRIPE_SECRET_KEY` | web | Stripe dashboard (Test mode) → Developers → API keys → **Secret key** (`sk_test_...`) — Step 7 |
| `STRIPE_WEBHOOK_SECRET` | web | From `stripe listen` locally, or the webhook endpoint in the Stripe dashboard in production (`whsec_...`) — Step 7 |
| `STRIPE_PRICE_ID` | web | Optional. Leave blank — the app creates the $1/active-employee price on demand. Set only if you pre-created a price. |
| `RESEND_API_KEY` | web, worker | Optional. Resend dashboard → API keys. Without it, emails are logged as skipped. — Step 8 |
| `ANTHROPIC_API_KEY` | web | Optional. Anthropic console → API keys. Powers the LLM shift-digest summary. — Step 8 |
| `ANTHROPIC_MODEL` | web | Optional. Model name; has a default if unset. |
| `CRON_SECRET` | web **and** worker | `openssl rand -hex 32`. Must be the **same value in both services** — the worker sends it as a Bearer <redacted> on `/api/shift-digest` and `/api/reports/email`. |
| `APP_URL` | worker | Public URL of the **web** service, e.g. `https://your-app.up.railway.app`. |

Order of operations: generate `APP_DB_PASSWORD` now (you'll need it in
Step 4). The rest can be filled in as you go.

---

## Step 4 — Run the migrations

This creates the non-owner `app_user` role, grants it exactly what it
needs, applies the 4 migration files in order, and verifies RLS is enabled
on all 21 tables. Run it from your own machine (Node 20+), once per
database.

1. Install the script dependencies:

   ```bash
   cd scripts
   npm install
   ```

2. Copy the Postgres plugin's owner connection string: in Railway, select
   the Postgres plugin → **Variables** tab → copy `DATABASE_URL`.

3. Generate the app password and run the migration:

   ```bash
   APP_DB_PASSWORD="$(openssl rand -base64 24)"
   DATABASE_OWNER_URL='postgres://postgres:<pw>@<host>:<port>/railway' \
   APP_DB_PASSWORD="$APP_DB_PASSWORD" \
   npm run migrate
   ```

   (Paste the plugin's `DATABASE_URL` in place of
   `postgres://postgres:<pw>@<host>:<port>/railway`.)

   **Save the printed `APP_DB_PASSWORD` value** — you need it in Step 3's
   `DATABASE_URL` for the web service. The runner sets the `app_user`
   role's password to it on every run, so the role password and your env
   var always agree.

4. Expected output ends with:

   ```
   Verification passed: all 21 tables exist with RLS enabled.
   Migration complete.
   ```

   If any table is missing or has RLS disabled, the run exits non-zero and
   names the offenders — fix before continuing.

What it does, in order:

1. `CREATE ROLE IF NOT EXISTS app_user LOGIN PASSWORD ...` (password
   refreshed every run).
2. Grants: `CONNECT` on the database; `USAGE` on schemas `public` and
   `app`; `SELECT, INSERT, UPDATE, DELETE` on all tables in `public`;
   `USAGE, SELECT` on all sequences; `EXECUTE` on all functions in `app`;
   plus `ALTER DEFAULT PRIVILEGES` so future tables/sequences/functions get
   the same grants automatically.
3. Applies `db/migrations/2026101101_schema.sql`,
   `2026101102_rls.sql`, `2026101103_seed.sql` (demo business data), and
   `2026101104_additions.sql` — one transaction per file.
4. Verifies all 21 tables exist **with RLS enabled**.

---

## Step 5 — Seed the demo users

The seed migration (Step 4) creates the demo business **Maple Street Diner**
with task templates, teams, and categories. The three demo *login accounts*
are created by a separate script (password hashing can't live in SQL):

```bash
cd scripts          # if not already there
npm install         # if not already done
DATABASE_OWNER_URL='postgres://postgres:<pw>@<host>:<port>/railway' \
npm run seed-users
```

Expected output:

```
Demo business: 'Maple Street Diner' (id <uuid>)
Password hashed with bcrypt (12 rounds).
  CREATED admin@maple.local  role=admin
  CREATED manager@maple.local  role=manager
  CREATED staff@maple.local  role=staff
Done: 3 created, 0 skipped.
```

The script is **idempotent** — re-running it skips emails that already
exist. All three accounts share the password:

| Email | Role | Password |
|---|---|---|
| `admin@maple.local` | admin | `demo1234!` |
| `manager@maple.local` | manager | `demo1234!` |
| `staff@maple.local` | staff | `demo1234!` |

---

## Step 6 — Open the app and sign in

1. In Railway, select the **web service** → **Settings** → **Networking** →
   **Generate Domain** (if you haven't). Open the generated URL.
2. Sign in at `/login` with one of the demo accounts from Step 5. Click
   around: Tasks board, Schedule, Shift Log, Clock, Reports, Settings →
   Billing.
3. **Sign up a brand-new business:** open `/signup` in a private window and
   register. Signup creates a new business with a **14-day free trial, no
   card required**, and makes you its admin. This is the real onboarding
   flow a customer would use.

---

## Step 7 — Stripe test mode

Billing is $1 per active employee per month via Stripe Checkout + Customer
Portal, with metered billing driven by the active-employee count.

1. Stripe dashboard → toggle **Test mode** ON → Developers → **API keys** →
   copy the **Secret key** (`sk_test_...`) into the web service's
   `STRIPE_SECRET_KEY`.
2. Install the Stripe CLI and forward webhooks to your local machine while
   testing (or create a real webhook endpoint in production pointing at
   `https://your-app.up.railway.app/api/stripe/webhook`):
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Copy the printed webhook signing secret (`whsec_...`) into the web
   service's `STRIPE_WEBHOOK_SECRET`. In production, create the endpoint in
   the dashboard (Events: `checkout.session.completed`,
   `customer.subscription.*`, `invoice.*` as wired in
   `web/app/api/stripe/webhook/route.ts`) and use its signing secret.
3. In the app, go to **Settings → Billing** as an admin and start a
   checkout with a Stripe test card (`4242 4242 4242 4242`, any future
   expiry, any CVC). Complete it, then open the Customer Portal from the
   same page.
4. `STRIPE_PRICE_ID` stays blank — the app creates the product and price
   on demand via `ensurePrice()` the first time billing runs.

---

## Step 8 (optional) — Resend, Anthropic, worker service env

- **Resend (emails):** create an API key at [resend.com](https://resend.com)
  → set `RESEND_API_KEY` on **both** the web service (report emails,
  shift-digest emails) and the worker service (trial-expiry notices).
  Without it, the app logs a skip line instead of sending — nothing throws.
- **Anthropic (shift-digest summary):** create a key at
  [console.anthropic.com](https://console.anthropic.com) → set
  `ANTHROPIC_API_KEY` on the **web service**. Without it, digest entries
  are still stored and viewable; only the AI summary section is skipped.
  `ANTHROPIC_MODEL` is optional (there's a default).
- **Worker service env recap:** the worker needs exactly three variables —
  `APP_URL` (web service's public URL), `CRON_SECRET` (same value as the
  web service), and `DATABASE_OWNER_URL` (owner connection string, e.g.
  `${{Postgres.DATABASE_URL}}`). `RESEND_API_KEY` is optional. The worker's
  start command is `node index.mjs` with root directory `worker/`. At
  startup each job runs once immediately, then on its interval (digest
  every 15 min, reports hourly, trials every 24 h); watch the service logs
  to confirm.

---

## Verification (what was checked in this build)

- `cd web && npx tsc --noEmit` — **zero errors**.
- `node --check` on all `scripts/*.mjs` and `worker/*.mjs` — all parse.
- Repo-wide grep for `@supabase`, `supabase.co`, `TODO`, `FIXME` —
  **no hits** (no Supabase remnants, no unfinished markers).
- The 4 migration files parse cleanly: `$$`-quoted function bodies are
  balanced and there are no `auth.*` (Supabase auth schema) references.
- `web/lib/delinquency.ts` is **byte-identical** to the Supabase v0.1
  build's `web/lib/delinquency.ts` (`cmp` clean) — the 24 delinquency edge
  cases verified against that shared logic carry over unchanged.
- RLS design reviewed: every app query runs as non-owner `app_user` inside
  `withUser()` with `SET LOCAL app.current_user_id`, and the migration
  verifier refuses to pass unless all 21 tables have RLS enabled.

---

## Known limits

- **No live Postgres or Docker in the build environment** — the Dockerfile,
  migrations, and seed script were written and statically verified but not
  executed end-to-end against a real database or container runtime.
- **Before production use, exercise two-business isolation**: create two
  businesses, add users to each, and confirm through the UI that no user
  can see the other business's tasks, staff, reports, or billing. The RLS
  policies are designed for this, but it has not been proven against a live
  database in this build.
- **Stripe, Resend, and Anthropic integrations are untested live** in this
  port — keys, webhooks, and email delivery need a real test-mode run
  (Steps 7–8) before charging anyone.
- The migration runner does not track which files it has applied — it
  re-applies all 4 files on every run. The schema file is safe to re-run;
  the **seed migration is append-only**: running `npm run migrate` twice
  creates a second "Maple Street Diner". Run it once per database (or make
  the seed idempotent before re-running). `npm run seed-users` *is*
  idempotent and can be re-run freely.
