-- ============================================================================
-- managemyteam.io — v0.1 contract addition (Railway Postgres port)
-- Migration 2026101104: shift_action_items.flagged_next
--
-- The shift-log spec requires action items to be "flaggable for next
-- manager-on-duty". The base schema omitted the flag column; this adds it.
-- The existing FOR ALL RLS policies on shift_action_items cover the new column
-- automatically (table-level policies).
-- ============================================================================

alter table public.shift_action_items
  add column if not exists flagged_next boolean not null default false;
