# managemyteam-worker

Background job worker for managemyteam.io. It is intentionally **not** a
Supabase Edge Function and **not** pg_cron: a plain Node process that runs
anywhere Node runs, needs no Supabase CLI deploy step, and calls the app's own
API routes so business logic lives in one place (the web app), not two.

Database access is Railway-native: the worker connects with the **`pg`**
driver through a single owner-level `Pool` (same code path as the web app's
owner pool — see `web/lib/db.ts`). There is no Supabase client anywhere in the
worker.

## Layout

```
worker/
  package.json      standalone deps — own `npm install`, never imports from web/
  config.mjs        env validation + shared helpers (logging, timezones, state, pg Pool)
  digest-runner.mjs shift-log digest sweep
  report-runner.mjs weekly report email sweep
  trial-runner.mjs  trial-expiry notices (pure worker-side, via Resend API)
  index.mjs         tiny scheduler (15m / 1h / 24h)
  .state/           local dedupe files (created at runtime; reports.json, trial.json)
```

## Run it

```bash
cd worker
npm install          # one dependency: pg
node index.mjs       # starts the scheduler; jobs also run once at startup
```

Or run a single job on demand (useful for testing):

```bash
node worker/digest-runner.mjs
node worker/report-runner.mjs
node worker/trial-runner.mjs
```

Logs go to stdout with ISO-8601 timestamps. A failing job logs the error and
the scheduler keeps going; it never crashes on one business's bad row.

## Environment

The worker reads its config from environment variables (see
`../.env.example` at the repo root). Required:

- `APP_URL` — base URL of the web app, e.g. `https://managemyteam.up.railway.app`
- `DATABASE_OWNER_URL` — owner-level Postgres connection string; the worker's
  pool connects as the DB owner, bypassing RLS (the same access level the
  old Supabase `service_role` key had). Falls back to `DATABASE_URL` when not
  set.
- `CRON_SECRET` — bearer token the app checks on `/api/shift-digest` and
  `/api/reports/email`

Optional: `RESEND_API_KEY` — without it, the trial runner logs a skip line
instead of sending expiry emails (nothing throws).

### CRON_SECRET setup

Generate once, then set the **same value** in both places:

```bash
openssl rand -hex 32
```

1. Worker environment (however you run it: `.env` file, systemd unit,
   Railway/Heroku config var, etc.).
2. Web app environment (`web/` — the API routes reject any request whose
   `Authorization: Bearer ...` header does not match).

Rotate by generating a new value and updating both sides at the same time.

## Running on Railway (production)

Two supported options — pick one:

**Option A: separate Railway service (recommended).** Create a new service in
the same Railway project (and private network), pointing at this repo with
these settings:

- Root directory: `worker/`
- Start command: `node index.mjs` (or `npm start` — same thing)
- Variables: the same `APP_URL`, `DATABASE_OWNER_URL` (or `DATABASE_URL`),
  `CRON_SECRET`, `RESEND_API_KEY` the web service uses — e.g. reference the
  shared Postgres plugin's connection string the same way the web service
  does.

The scheduler keeps one Node process alive; the runners self-skip on their
cadences (digest every 15 min, reports hourly, trials daily), so idle cost is
essentially zero. `index.mjs` runs each job once at startup, so a fresh
deploy never waits a full interval.

**Option B: Railway cron.** Instead of a long-lived service, schedule three
cron invocations on the cadence above that each run a single runner
(`node digest-runner.mjs` on a 15-minute cron, `node report-runner.mjs`
hourly, `node trial-runner.mjs` daily) against the same image/env. Each run
closes the pg pool before exiting, so nothing lingers.

Either way, the worker talks to the app only over HTTPS with the
`Authorization: Bearer ${CRON_SECRET}` header — no shared filesystem, no
shared code — so it works identically whether it lives on Railway, locally,
or anywhere else.

### Production alternative

For production, the scheduled jobs could move to Supabase-native
infrastructure (only relevant if the stack ever moves back to Supabase):

- **Supabase Edge Functions + pg_cron**: schedule `pg_cron` to invoke an Edge
  Function on the cadence above; the function calls the same app endpoints.
- Or keep this worker and run it as a long-lived process (Railway worker
  service, Fly.io machine, systemd unit) with the env vars set.

Why the worker won for v0.1: zero deploy pipeline (no `supabase functions
deploy`, no SQL cron setup), runnable locally with `node index.mjs`, and the
same code path runs in dev and prod. Revisit when ops wants everything inside
Supabase.

## What each runner does

**digest-runner** (every 15 min) — for each business with
`digest_schedule.enabled`, computes today's scheduled time (default 18:00) in
the business's own `digest_schedule.timezone`, and if now is past it, checks
`shift_digests` for a row covering this run
(`period_end >=` today's local date AND `created_at >=` the scheduled
instant). If none exists, it `POST`s `{business_id}` to
`/api/shift-digest` with `Authorization: Bearer ${CRON_SECRET}`. The web app
does the sweep + LLM summarization and stores the digest; the worker just
triggers and logs the result (`stored (id)` or `null` when there was nothing
to summarize).

**report-runner** (hourly) — for each business with a
`stripe_subscription_id` OR a trial configured (`trial_ends_at` set), checks
the business-local clock: on Monday after 08:00 local it `POST`s
`{business_id, range:'week'}` to `/api/reports/email` with the bearer token.
Dedupe is local — one send per business per ISO week, recorded in
`worker/.state/reports.json` — because v0.1 has no "reports sent" table. If
the 08:00 tick is missed, the next hourly tick the same Monday still sends.

**trial-runner** (daily) — finds businesses where `trial_ends_at < now()` and
`stripe_subscription_id IS NULL`, looks up active admins
(`users.role = 'admin'`, not terminated), and sends a
"your trial has expired — add a payment method in Settings > Billing" email
directly through the Resend HTTP API. One notice per business per distinct
`trial_ends_at` (recorded in `worker/.state/trial.json`), so admins are not
re-emailed every day. The `From` address (`team@managemyteam.io`) must match
a verified Resend sender domain — change `FROM` in `trial-runner.mjs` to your
own before going live.

## Delinquency-sweep tradeoff (documented decision)

Task delinquency status is computed **on demand at read time** — the app
derives "overdue / delinquent" from due dates and push counts when it renders,
so there is no scheduled sweep job to flip a status column. This is correct
at v0.1 scale: the status is never stale by construction, and there is one
less job to operate.

A sweep would only matter later, if we ever need push-notification-style
alerting ("tell the manager the moment a task crosses the delinquency
limit") — i.e., reacting to a state *transition* rather than reading current
state. If that feature lands, the natural home is a new worker runner that
diffs transitions and fires notifications; it does not exist yet.
