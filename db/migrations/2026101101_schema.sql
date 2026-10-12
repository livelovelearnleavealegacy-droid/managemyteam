-- ============================================================================
-- managemyteam.io — v0.1 schema (Railway Postgres port)
-- Migration 2026101101: core schema — tables, indexes, constraints, helpers
--
-- Ported from the Supabase migrations for plain PostgreSQL (Railway Postgres
-- plugin). pgcrypto is available; no other extensions are used.
--
-- Applies to a FRESH database. Apply order:
--   1. 2026101101_schema.sql   (this file: app schema, helpers, tables)
--   2. 2026101102_rls.sql      (RLS enablement + policies; needs helpers)
--   3. 2026101103_seed.sql      (demo business; needs tables)
--   4. 2026101104_additions.sql (shift_action_items.flagged_next)
--
-- Multi-tenancy contract (locked):
--   * Every tenant table carries business_id UUID NOT NULL FK -> businesses(id)
--     ON DELETE CASCADE, and tenant isolation is enforced by RLS at the DB layer.
--   * Composite tenant FKs (business_id, <parent>_id) -> parent(business_id, id)
--     are used wherever both columns are NOT NULL, so a row can never point at
--     a parent in another business. This requires UNIQUE(business_id, id) on the
--     referenced tables (users, teams, task_templates).
--   * Nullable references (assigned_user_id, category_id, created_by, ...) use
--     simple single-column FKs, because ON DELETE SET NULL cannot null only part
--     of a composite FK. Cross-tenant links on those are blocked by RLS instead
--     (a caller can only read rows in their own business, so they can only
--     reference rows in their own business).
--   * ON DELETE CASCADE on business_id: deleting a business removes its data.
--     Businesses are never deleted through the app in v0.1.
--   * RLS + FK cascades: PostgreSQL applies RLS to rows touched by FK cascades,
--     so a cascade only proceeds if the deleter also satisfies the child table's
--     policies. App-mediated hard deletes (users) run via the owner/migration
--     connection (which bypasses RLS), so their cascades always complete. See
--     2026101102_rls.sql.
--
-- Identity model (Railway port): there is no Supabase Auth here. The app uses
-- Auth.js (credentials provider); public.users carries password_hash for it.
-- Per-request identity is delivered to the DB as a session variable:
--   SET LOCAL app.current_user_id = '<uuid>';
-- read via app.current_user_id(). The app connects as the NON-OWNER role
-- app_user (created by scripts/migrate.mjs) so RLS applies.
--
-- No report_card / subject / client tables exist in v0.1 (locked: out of scope).
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists pgcrypto;

-- App schema for helper functions ---------------------------------------------
create schema if not exists app;

-- Helper functions ------------------------------------------------------------
-- app.current_user_id() reads the session variable the app sets per request.
-- SECURITY INVOKER is fine (it touches no tables); explicit search_path keeps
-- it safe. Returns NULL when the variable is unset/empty.
create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = public, app
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- 1. businesses ----------------------------------------------------------------
create table public.businesses (
  id                   uuid        primary key default gen_random_uuid(),
  name                 text        not null,
  default_max_pushes   integer     not null default 3,
  digest_schedule      jsonb       not null default '{"enabled":true,"time":"18:00","timezone":"America/Chicago"}'::jsonb,
  stripe_customer_id   text,
  stripe_subscription_id text,
  trial_ends_at        timestamptz,
  created_at           timestamptz not null default now()
);

-- 2. users ----------------------------------------------------------------------
-- Credentials live in password_hash (Auth.js credentials provider). There is no
-- auth.users table on Railway Postgres, so id is a plain UUID PK owned by the app.
-- Termination is soft (terminated_at + termination_effective_date); hard delete
-- is app-mediated via the owner/migration connection and only after termination.
create table public.users (
  id                         uuid        primary key default gen_random_uuid(),
  business_id                uuid        not null references public.businesses(id) on delete cascade,
  email                      text        not null,
  name                       text        not null,
  password_hash              text,
  role                       text        not null default 'staff' check (role in ('admin','manager','staff')),
  terminated_at              timestamptz,
  termination_effective_date date,
  created_at                 timestamptz not null default now(),
  unique (business_id, email),
  unique (business_id, id)  -- FK target for composite tenant FKs
);

-- 3. teams -----------------------------------------------------------------------
create table public.teams (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  name        text        not null,
  created_at  timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)  -- FK target for composite tenant FKs
);

-- 4. team_members ------------------------------------------------------------------
create table public.team_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  team_id     uuid not null,
  user_id     uuid not null,
  primary key (team_id, user_id),
  foreign key (business_id, team_id) references public.teams(business_id, id) on delete cascade,
  foreign key (business_id, user_id) references public.users(business_id, id) on delete cascade
);

-- 5. categories ----------------------------------------------------------------------
create table public.categories (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  name        text        not null,
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);

-- 6. task_templates ---------------------------------------------------------------------
-- recurrence is one of:
--   {"kind":"once","date":"YYYY-MM-DD"}
--   {"kind":"daily"}
--   {"kind":"weekly","weekdays":[0-6]}            (0 = Sunday)
--   {"kind":"monthly","days":[1-31],"months":[1-12]}
-- checklist is an array of {"label": "..."} objects.
-- max_pushes NULL means "use the business default_max_pushes".
-- Exactly one assignee must be set, matching assignment_type.
-- category_id is a simple (non-composite) FK because ON DELETE SET NULL cannot
-- null only part of a composite FK; RLS blocks cross-tenant references.
create table public.task_templates (
  id               uuid        primary key default gen_random_uuid(),
  business_id      uuid        not null references public.businesses(id) on delete cascade,
  title            text        not null,
  description      text        not null default '',
  checklist        jsonb       not null default '[]'::jsonb,
  require_photo    boolean     not null default false,
  category_id      uuid        references public.categories(id) on delete set null,
  assignment_type  text        not null check (assignment_type in ('user','team')),
  assigned_user_id uuid,
  assigned_team_id uuid,
  recurrence       jsonb       not null check ((recurrence->>'kind') in ('once','daily','weekly','monthly')),
  max_pushes       integer     check (max_pushes is null or max_pushes >= 0),
  created_by       uuid        references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (business_id, id),  -- FK target for composite tenant FKs
  foreign key (business_id, assigned_user_id) references public.users(business_id, id),
  foreign key (business_id, assigned_team_id) references public.teams(business_id, id),
  check (
    (assignment_type = 'user' and assigned_user_id is not null and assigned_team_id is null)
    or
    (assignment_type = 'team' and assigned_team_id is not null and assigned_user_id is null)
  )
);

-- 7. task_instance_state -----------------------------------------------------------------
-- One row per live instance of a recurring template. instance_key format:
--   {templateId}_{originalDate}   e.g. "9f3a…c1_2026-10-12"
-- Pushing a task to tomorrow bumps push_count and moves effective_date; the
-- business default_max_pushes (overridable per template) caps the pushes.
create table public.task_instance_state (
  business_id   uuid    not null references public.businesses(id) on delete cascade,
  template_id   uuid    not null,
  instance_key  text    not null,
  original_date date    not null,
  push_count    integer not null default 0 check (push_count >= 0),
  effective_date date   not null,
  primary key (template_id, instance_key),
  foreign key (business_id, template_id) references public.task_templates(business_id, id) on delete cascade
);

-- 8. task_completions ----------------------------------------------------------------------
-- completed_by is nullable + SET NULL so completion history survives a hard
-- delete of the user row (audit trail).
create table public.task_completions (
  id              uuid        primary key default gen_random_uuid(),
  business_id     uuid        not null references public.businesses(id) on delete cascade,
  template_id     uuid        not null,
  instance_key    text        not null,
  completed_by    uuid        references public.users(id) on delete set null,
  completed_at    timestamptz not null default now(),
  checklist_state jsonb       not null default '[]'::jsonb,
  photo_url       text,
  foreign key (business_id, template_id) references public.task_templates(business_id, id) on delete cascade
);

-- 9. shift_entries ------------------------------------------------------------------------------
-- user_id NULL means the entry was generated by the system (auto:* sources).
-- linked carries the triggering entity, e.g. {"entity":"task_instance",
-- "template_id":"…","instance_key":"…"}.
create table public.shift_entries (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        references public.users(id) on delete set null,
  shift_date  date        not null,
  body        text        not null,
  source      text        not null check (source in ('manual','voice','auto:task_delinquent','auto:incident_filed','auto:timeoff_approved','auto:termination','auto:inspection_failed')),
  linked      jsonb,
  created_at  timestamptz not null default now()
);

-- 10. shift_action_items -------------------------------------------------------------------------------
create table public.shift_action_items (
  id              uuid        primary key default gen_random_uuid(),
  business_id     uuid        not null references public.businesses(id) on delete cascade,
  shift_entry_id  uuid        references public.shift_entries(id) on delete set null,
  title           text        not null,
  due_date        date        not null,
  escalation_days integer     not null check (escalation_days >= 0),
  status          text        not null default 'open' check (status in ('open','done')),
  done_at         timestamptz,
  escalated       boolean     not null default false,
  escalated_at    timestamptz,
  created_by      uuid        references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- 11. shift_digests ----------------------------------------------------------------------------------------
-- source_entry_ids references shift_entries by id (uuid[]; no FK — digests are
-- point-in-time snapshots and must survive entry cleanup).
create table public.shift_digests (
  id               uuid        primary key default gen_random_uuid(),
  business_id      uuid        not null references public.businesses(id) on delete cascade,
  period_start     date        not null,
  period_end       date        not null,
  summary          text        not null,
  source_entry_ids uuid[]      not null default '{}',
  created_at       timestamptz not null default now(),
  check (period_end >= period_start)
);

-- 12. chat_messages ----------------------------------------------------------------------------------------------
-- team_id NULL = the Everyone channel. team_id FK is NO ACTION (restrict): a
-- team with chat history cannot be deleted until its messages are handled.
create table public.chat_messages (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  team_id     uuid,
  user_id     uuid        not null,
  body        text        not null,
  created_at  timestamptz not null default now(),
  foreign key (business_id, team_id) references public.teams(business_id, id),
  foreign key (business_id, user_id) references public.users(business_id, id) on delete cascade
);

-- 13. announcements --------------------------------------------------------------------------------------------------
create table public.announcements (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  title       text,
  body        text        not null,
  created_at  timestamptz not null default now()
);

-- 14. kudos ---------------------------------------------------------------------------------------------------------------
create table public.kudos (
  id           uuid        primary key default gen_random_uuid(),
  business_id  uuid        not null references public.businesses(id) on delete cascade,
  from_user_id uuid        not null references public.users(id) on delete cascade,
  to_user_id   uuid        not null references public.users(id) on delete cascade,
  body         text        not null,
  created_at   timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

-- 15. knowledge_articles ---------------------------------------------------------------------------------------------------------
-- user_id is nullable + SET NULL so articles survive a hard delete of the author.
create table public.knowledge_articles (
  id         uuid        primary key default gen_random_uuid(),
  business_id uuid       not null references public.businesses(id) on delete cascade,
  user_id    uuid        references public.users(id) on delete set null,
  title      text        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 16. shifts ---------------------------------------------------------------------------------------------------------------------------
-- Overnight shifts are represented with end_time < start_time (e.g. 22:00–06:00),
-- so no ordering check is applied.
create table public.shifts (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  date        date        not null,
  start_time  time        not null,
  end_time    time        not null,
  notes       text        not null default '',
  created_by  uuid        references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 17. time_clock_entries -------------------------------------------------------------------------------------------------------------------
create table public.time_clock_entries (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  clock_in    timestamptz not null default now(),
  clock_out   timestamptz,
  created_at  timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in)
);

-- 18. incident_reports ----------------------------------------------------------------------------------------------------------------------------
-- user_id is nullable + SET NULL so incident history survives a hard delete of
-- the filing user (audit trail).
create table public.incident_reports (
  id           uuid        primary key default gen_random_uuid(),
  business_id  uuid        not null references public.businesses(id) on delete cascade,
  user_id      uuid        references public.users(id) on delete set null,
  subject      text        not null,
  severity     text        check (severity in ('Minor','Moderate','Serious')),
  description  text        not null,
  action_taken text        not null default '',
  created_at   timestamptz not null default now()
);

-- 19. inspections --------------------------------------------------------------------------------------------------------------------------------------
-- checklist must carry the boolean keys clean, hazard_free, equipment_ok.
-- user_id is nullable + SET NULL so inspection history survives a hard delete
-- of the inspecting user (audit trail).
create table public.inspections (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        references public.users(id) on delete set null,
  area        text        not null,
  checklist   jsonb       not null,
  passed      boolean     not null,
  notes       text        not null default '',
  created_at  timestamptz not null default now(),
  check ((checklist ? 'clean') and (checklist ? 'hazard_free') and (checklist ? 'equipment_ok'))
);

-- 20. time_off_requests ---------------------------------------------------------------------------------------------------------------------------------------
create table public.time_off_requests (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  start_date  date        not null,
  end_date    date        not null,
  reason      text        not null,
  status      text        not null default 'pending' check (status in ('pending','approved','denied')),
  decided_by  uuid        references public.users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 21. stripe_events (global — NOT tenant-scoped) ------------------------------------------------------------------------------------------------------------------
-- Webhook idempotency log. No business_id by design; RLS denies all app roles
-- (owner connection only). See 2026101102_rls.sql.
create table public.stripe_events (
  id         text        primary key,
  type       text,
  created_at timestamptz not null default now()
);

-- Indexes ---------------------------------------------------------------------------------------------------------------------------
-- business_id on every tenant table (tenant isolation + join performance).
create index idx_users_business_id               on public.users (business_id);
create index idx_teams_business_id               on public.teams (business_id);
create index idx_team_members_business_id        on public.team_members (business_id);
create index idx_categories_business_id          on public.categories (business_id);
create index idx_task_templates_business_id      on public.task_templates (business_id);
create index idx_task_instance_state_business_id on public.task_instance_state (business_id);
create index idx_task_completions_business_id    on public.task_completions (business_id);
create index idx_shift_entries_business_id       on public.shift_entries (business_id);
create index idx_shift_action_items_business_id  on public.shift_action_items (business_id);
create index idx_shift_digests_business_id       on public.shift_digests (business_id);
create index idx_chat_messages_business_id       on public.chat_messages (business_id);
create index idx_announcements_business_id       on public.announcements (business_id);
create index idx_kudos_business_id               on public.kudos (business_id);
create index idx_knowledge_articles_business_id  on public.knowledge_articles (business_id);
create index idx_shifts_business_id              on public.shifts (business_id);
create index idx_time_clock_entries_business_id  on public.time_clock_entries (business_id);
create index idx_incident_reports_business_id    on public.incident_reports (business_id);
create index idx_inspections_business_id         on public.inspections (business_id);
create index idx_time_off_requests_business_id   on public.time_off_requests (business_id);

-- Workload-specific indexes.
create index idx_shift_entries_business_shift_date on public.shift_entries (business_id, shift_date);
create index idx_chat_messages_business_created    on public.chat_messages (business_id, created_at);
create index idx_task_completions_template_instance on public.task_completions (template_id, instance_key);
-- Billing: count of active (non-terminated) users per business.
create index idx_users_billing_count on public.users (business_id, terminated_at);


-- Helper functions (table-referencing) ------------------------------------------------
-- These MUST come after the table definitions above: PostgreSQL validates SQL
-- function bodies at CREATE time, and these query public.users.

-- The remaining helpers are SECURITY DEFINER so they bypass RLS (owned by the
-- migration role). Return NULL when the caller has no public.users row (not
-- onboarded yet); RLS policies treat NULL as "deny", except the onboarding
-- insert path which explicitly checks for NULL.
create or replace function app.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select business_id from public.users where id = app.current_user_id()
$$;

create or replace function app.current_role()
returns text
language sql
stable
security definer
set search_path = public, app
as $$
  select role from public.users where id = app.current_user_id()
$$;

create or replace function app.is_manager_or_above()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select (role in ('admin', 'manager')) from public.users where id = app.current_user_id()
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select (role = 'admin') from public.users where id = app.current_user_id()
$$;
--
-- Founder check: true when a business has no users yet. SECURITY DEFINER so it
-- bypasses RLS (the onboarding caller can see no users rows by design).
-- Used by the users_insert_onboarding policy to bind self-onboarding to a
-- brand-new business only — an authenticated user with no users row cannot
-- attach themselves (as admin) to someone else's business.
create or replace function app.business_has_no_users(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select not exists (select 1 from public.users where business_id = b)
$$;
