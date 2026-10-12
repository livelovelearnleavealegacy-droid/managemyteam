-- ============================================================================
-- managemyteam.io — v0.1 RLS (Railway Postgres port)
-- Migration 2026101102: Row Level Security — enablement + policies.
-- Requires 2026101101_schema.sql (tables + app.* helper functions).
--
-- Identity: app.current_user_id() reads the per-request session variable
--   SET LOCAL app.current_user_id = '<uuid>';
-- set by the API layer from the Auth.js session. The app connects as the
-- NON-OWNER role app_user (see scripts/migrate.mjs) so these policies apply.
--
-- Conventions used below:
--   * "same business"  = business_id = app.current_business_id()
--   * "manager+"       = app.is_manager_or_above()  (role in ('admin','manager'))
--   * Helpers are SECURITY DEFINER and return NULL when the caller has no
--     public.users row; NULL is treated as deny everywhere except the two
--     onboarding insert policies.
--
-- Onboarding path (signup): an authenticated user with NO public.users row may
--   (a) INSERT one row into businesses, then
--   (b) INSERT their own row into users (id = app.current_user_id()).
-- After (b) they are a member and the normal policies apply.
--
-- RLS + FK cascades: PostgreSQL applies RLS to rows touched by FK cascades, so
-- a cascade only completes if the deleter also satisfies the child table's
-- policies. App-mediated hard deletes of users run via the owner/migration
-- connection (which bypasses RLS), so their cascades always complete. Direct
-- deletes through the app client are limited to what the policies below allow.
--
-- Task photos: storage moved to API routes + a Railway volume. There are no
-- Supabase storage buckets or storage policies in this port.
-- ============================================================================

-- Enable RLS on every table ------------------------------------------------------
alter table public.businesses          enable row level security;
alter table public.users               enable row level security;
alter table public.teams               enable row level security;
alter table public.team_members        enable row level security;
alter table public.categories          enable row level security;
alter table public.task_templates      enable row level security;
alter table public.task_instance_state enable row level security;
alter table public.task_completions    enable row level security;
alter table public.shift_entries       enable row level security;
alter table public.shift_action_items  enable row level security;
alter table public.shift_digests       enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.announcements       enable row level security;
alter table public.kudos               enable row level security;
alter table public.knowledge_articles   enable row level security;
alter table public.shifts              enable row level security;
alter table public.time_clock_entries  enable row level security;
alter table public.incident_reports    enable row level security;
alter table public.inspections         enable row level security;
alter table public.time_off_requests   enable row level security;
alter table public.stripe_events       enable row level security;

-- businesses -----------------------------------------------------------------------
-- select: members of the business. insert: onboarding only. update: admin only.
-- (No delete policy: businesses are never deleted through the app in v0.1.)
create policy businesses_select on public.businesses
  for select
  using (id = app.current_business_id());

create policy businesses_insert_onboarding on public.businesses
  for insert
  with check (app.current_business_id() is null);

create policy businesses_update_admin on public.businesses
  for update
  using (id = app.current_business_id() and app.is_admin())
  with check (id = app.current_business_id() and app.is_admin());

-- users ------------------------------------------------------------------------------
-- select: same business. insert: own row during onboarding, or admin adding a
-- member. update/delete: admin only.
-- NOTE (v0.1): users cannot update their own profile (not even their name);
-- updates are admin-only by design. A self-service name-update policy can be
-- added later without breaking this contract.
create policy users_select on public.users
  for select
  using (business_id = app.current_business_id());

create policy users_insert_onboarding on public.users
  for insert
  with check (
    id = app.current_user_id()
    and role = 'admin'
    and app.current_business_id() is null
    and app.business_has_no_users(business_id)
  );

create policy users_insert_admin on public.users
  for insert
  with check (business_id = app.current_business_id() and app.is_admin());

create policy users_update_admin on public.users
  for update
  using (business_id = app.current_business_id() and app.is_admin())
  with check (business_id = app.current_business_id() and app.is_admin());

create policy users_delete_admin on public.users
  for delete
  using (business_id = app.current_business_id() and app.is_admin());

-- teams -------------------------------------------------------------------------------
-- select: same business. insert/update/delete: manager+.
create policy teams_select on public.teams
  for select
  using (business_id = app.current_business_id());

create policy teams_insert_manager on public.teams
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy teams_update_manager on public.teams
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy teams_delete_manager on public.teams
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- team_members --------------------------------------------------------------------------
-- select: same business. insert/update/delete: manager+.
create policy team_members_select on public.team_members
  for select
  using (business_id = app.current_business_id());

create policy team_members_insert_manager on public.team_members
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy team_members_update_manager on public.team_members
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy team_members_delete_manager on public.team_members
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- categories ------------------------------------------------------------------------------
-- select: same business. insert/update/delete: manager+.
create policy categories_select on public.categories
  for select
  using (business_id = app.current_business_id());

create policy categories_insert_manager on public.categories
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy categories_update_manager on public.categories
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy categories_delete_manager on public.categories
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- task_templates ------------------------------------------------------------------------------
-- select: same business. insert/update/delete: manager+.
create policy task_templates_select on public.task_templates
  for select
  using (business_id = app.current_business_id());

create policy task_templates_insert_manager on public.task_templates
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy task_templates_update_manager on public.task_templates
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy task_templates_delete_manager on public.task_templates
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- task_instance_state -------------------------------------------------------------------------------
-- select/insert/update: same business. The APP enforces which assignees may push
-- an instance (assignment visibility); the DB enforces tenancy only.
-- Delete policy (manager+) exists so template-delete cascades can complete
-- under RLS; instance history is otherwise append-only in v0.1.
create policy task_instance_state_select on public.task_instance_state
  for select
  using (business_id = app.current_business_id());

create policy task_instance_state_insert on public.task_instance_state
  for insert
  with check (business_id = app.current_business_id());

create policy task_instance_state_update on public.task_instance_state
  for update
  using (business_id = app.current_business_id())
  with check (business_id = app.current_business_id());

create policy task_instance_state_delete_manager on public.task_instance_state
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- task_completions ---------------------------------------------------------------------------------------
-- select/insert: same business (managers may record a completion on behalf of
-- staff, so completed_by is intentionally NOT tied to the session user).
-- Delete policy (manager+) exists so template-delete cascades can complete
-- under RLS.
create policy task_completions_select on public.task_completions
  for select
  using (business_id = app.current_business_id());

create policy task_completions_insert on public.task_completions
  for insert
  with check (business_id = app.current_business_id());

create policy task_completions_delete_manager on public.task_completions
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- shift_entries / shift_action_items / shift_digests ------------------------------------------------------------
-- Manager+ only, all operations. Staff get NO access to the shift log surface.
create policy shift_entries_manager_all on public.shift_entries
  for all
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

-- Auto-log inserts: any business member may INSERT system-authored auto entries
-- (e.g. a staff push that exhausts pushes, an incident filing, a time-off
-- approval, a termination, a failed inspection). Staff still cannot SELECT the
-- log — the manager-only read surface is unchanged.
create policy shift_entries_insert_auto on public.shift_entries
  for insert
  with check (
    business_id = app.current_business_id()
    and source like 'auto:%'
  );

create policy shift_action_items_manager_all on public.shift_action_items
  for all
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy shift_digests_manager_all on public.shift_digests
  for all
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

-- chat_messages ----------------------------------------------------------------------------------------------------
-- select: same business AND (Everyone channel OR member of the team channel OR
-- manager+). insert: own messages only. No update/delete in v0.1 (immutable).
create policy chat_messages_select on public.chat_messages
  for select
  using (
    business_id = app.current_business_id()
    and (
      team_id is null
      or team_id in (select tm.team_id from public.team_members tm where tm.user_id = app.current_user_id())
      or app.is_manager_or_above()
    )
  );

create policy chat_messages_insert on public.chat_messages
  for insert
  with check (business_id = app.current_business_id() and user_id = app.current_user_id());

-- announcements ----------------------------------------------------------------------------------------------------------
-- select: same business. insert/update: manager+. delete: admin.
create policy announcements_select on public.announcements
  for select
  using (business_id = app.current_business_id());

create policy announcements_insert_manager on public.announcements
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy announcements_update_manager on public.announcements
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy announcements_delete_admin on public.announcements
  for delete
  using (business_id = app.current_business_id() and app.is_admin());

-- kudos ----------------------------------------------------------------------------------------------------------------------
-- select: same business. insert: same business, sent as yourself.
-- No update/delete in v0.1 (immutable).
create policy kudos_select on public.kudos
  for select
  using (business_id = app.current_business_id());

create policy kudos_insert on public.kudos
  for insert
  with check (business_id = app.current_business_id() and from_user_id = app.current_user_id());

-- knowledge_articles ----------------------------------------------------------------------------------------------------------------
-- select: same business. insert/update/delete: manager+.
create policy knowledge_articles_select on public.knowledge_articles
  for select
  using (business_id = app.current_business_id());

create policy knowledge_articles_insert_manager on public.knowledge_articles
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy knowledge_articles_update_manager on public.knowledge_articles
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy knowledge_articles_delete_manager on public.knowledge_articles
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- shifts --------------------------------------------------------------------------------------------------------------------------------
-- select: own shifts, or all shifts for manager+. insert/update/delete: manager+.
create policy shifts_select on public.shifts
  for select
  using (business_id = app.current_business_id() and (user_id = app.current_user_id() or app.is_manager_or_above()));

create policy shifts_insert_manager on public.shifts
  for insert
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy shifts_update_manager on public.shifts
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

create policy shifts_delete_manager on public.shifts
  for delete
  using (business_id = app.current_business_id() and app.is_manager_or_above());

-- time_clock_entries ----------------------------------------------------------------------------------------------------------------------------
-- select: own entries, or all for manager+. insert: clock in as yourself.
-- update: your own OPEN entry (to clock out), or manager+. No delete in v0.1
-- (time records are immutable).
-- NOTE: the update policy cannot restrict staff to the clock_out column only
-- (RLS has no per-column update policies); the app must only ever issue
-- clock_out updates for staff.
create policy time_clock_entries_select on public.time_clock_entries
  for select
  using (business_id = app.current_business_id() and (user_id = app.current_user_id() or app.is_manager_or_above()));

create policy time_clock_entries_insert on public.time_clock_entries
  for insert
  with check (business_id = app.current_business_id() and user_id = app.current_user_id());

create policy time_clock_entries_update on public.time_clock_entries
  for update
  using (
    business_id = app.current_business_id()
    and (app.is_manager_or_above() or (user_id = app.current_user_id() and clock_out is null))
  )
  with check (
    business_id = app.current_business_id()
    and (app.is_manager_or_above() or user_id = app.current_user_id())
  );

-- incident_reports ------------------------------------------------------------------------------------------------------------------------------------
-- select/insert: same business (anyone may file; the filer is recorded in
-- user_id but not tied to the session user so managers can file on behalf of
-- staff). No update/delete in v0.1 (immutable audit trail).
create policy incident_reports_select on public.incident_reports
  for select
  using (business_id = app.current_business_id());

create policy incident_reports_insert on public.incident_reports
  for insert
  with check (business_id = app.current_business_id());

-- inspections ------------------------------------------------------------------------------------------------------------------------------------------------
-- select/insert: same business (same filing flexibility as incident_reports).
-- No update/delete in v0.1 (immutable audit trail).
create policy inspections_select on public.inspections
  for select
  using (business_id = app.current_business_id());

create policy inspections_insert on public.inspections
  for insert
  with check (business_id = app.current_business_id());

-- time_off_requests ------------------------------------------------------------------------------------------------------------------------------------------------------
-- select: own requests, or all for manager+. insert: request as yourself.
-- update (approve/deny): manager+. No delete in v0.1.
-- NOTE (v0.1): staff cannot edit or cancel their own pending requests; the
-- manager decision path is the only update path.
create policy time_off_requests_select on public.time_off_requests
  for select
  using (business_id = app.current_business_id() and (user_id = app.current_user_id() or app.is_manager_or_above()));

create policy time_off_requests_insert on public.time_off_requests
  for insert
  with check (business_id = app.current_business_id() and user_id = app.current_user_id());

create policy time_off_requests_update_manager on public.time_off_requests
  for update
  using (business_id = app.current_business_id() and app.is_manager_or_above())
  with check (business_id = app.current_business_id() and app.is_manager_or_above());

-- stripe_events ---------------------------------------------------------------------------------------------------------------------------------------------------------------
-- No policies: RLS denies everything for the app_user role. The Stripe webhook
-- handler runs on the owner/migration connection, which bypasses RLS.

-- ============================================================================
-- VERIFICATION (run after applying all migrations; must return zero rows):
--
--   select c.relname as table_missing_rls
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public'
--     and c.relkind = 'r'
--     and not c.relrowsecurity;
--
-- Spot-check helper wiring (as the app_user role with a session variable set):
--   set local app.current_user_id = '<uuid>';
--   select app.current_business_id(), app.current_role(),
--          app.is_manager_or_above(), app.is_admin();
-- ============================================================================
