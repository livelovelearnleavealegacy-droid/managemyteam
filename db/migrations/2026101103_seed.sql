-- ============================================================================
-- managemyteam.io — v0.1 seed (Railway Postgres port)
-- Migration 2026101103: demo business "Maple Street Diner" — business-side data.
-- Requires 2026101101_schema.sql and 2026101102_rls.sql (runs as the migration
-- role, which bypasses RLS).
--
-- NOTE: demo USERS are NOT created here. Demo user rows (with password_hash
-- for Auth.js credentials auth) are created by the seed script
-- (../scripts/seed-users.mjs), because credential identity lives outside the
-- migrations' reach. Run the seed script after this migration.
--
-- Seeds: 1 business (14-day trial), 5 categories, 3 teams, 6 task templates
-- covering every recurrence kind (once / daily / weekly / monthly).
-- ============================================================================

with b as (
  insert into public.businesses (name, default_max_pushes, trial_ends_at)
  values ('Maple Street Diner', 3, now() + interval '14 days')
  returning id
),
cats as (
  insert into public.categories (business_id, name)
  select b.id, x.name
  from b
  cross join unnest(array['Opening','Closing','Cleaning','Food Safety','Maintenance']) as x(name)
  returning id, name
),
teams as (
  insert into public.teams (business_id, name)
  select b.id, x.name
  from b
  cross join unnest(array['Front of House','Back of House','Managers']) as x(name)
  returning id, name
)
insert into public.task_templates
  (business_id, title, description, checklist, require_photo, category_id,
   assignment_type, assigned_team_id, recurrence, max_pushes)
select
  b.id,
  v.title,
  v.description,
  v.checklist::jsonb,
  v.require_photo,
  c.id,
  'team',
  t.id,
  v.recurrence::jsonb,
  v.max_pushes::integer
from b
cross join (values
  (
    'Morning opening checklist',
    'Get the diner ready before the doors open at 6 AM.',
    '[{"label":"Unlock front doors and disarm alarm"},{"label":"Start coffee brewers (regular and decaf)"},{"label":"Wipe tables; refill napkins and condiments"},{"label":"Stock pie case and turn on display lights"},{"label":"Photo: front counter ready for service"}]',
    true,
    'Opening', 'Front of House',
    '{"kind":"daily"}',
    null
  ),
  (
    'Nightly closing checklist',
    'Shut down the diner after the dinner rush.',
    '[{"label":"Mop dining room and kitchen floors"},{"label":"Clean and sanitize grill and flat top"},{"label":"Count cash drawer and drop the safe"},{"label":"Set alarm and lock the back door"}]',
    false,
    'Closing', 'Back of House',
    '{"kind":"daily"}',
    null
  ),
  (
    'Weekly deep clean',
    'Top-to-bottom clean every Sunday.',
    '[{"label":"Degrease hood vents"},{"label":"Pull out and clean behind fryers"},{"label":"Scrub walk-in floors and organize shelves"},{"label":"Wash windows inside and out"}]',
    false,
    'Cleaning', 'Back of House',
    '{"kind":"weekly","weekdays":[0]}',
    null
  ),
  (
    'Hood filter cleaning',
    'Monthly hood filter soak and scrub, first of the month.',
    '[{"label":"Remove hood filters"},{"label":"Soak in degreaser per label directions"},{"label":"Scrub, rinse, air-dry, and reinstall"}]',
    false,
    'Maintenance', 'Back of House',
    '{"kind":"monthly","days":[1],"months":[1,2,3,4,5,6,7,8,9,10,11,12]}',
    null
  ),
  (
    'Fire extinguisher inspection',
    'Quarterly extinguisher pressure and tag check.',
    '[{"label":"Check pressure gauge reads in the green"},{"label":"Verify inspection tag is current"},{"label":"Confirm extinguisher is mounted and accessible"}]',
    false,
    'Maintenance', 'Managers',
    '{"kind":"monthly","days":[15],"months":[1,4,7,10]}',
    null
  ),
  (
    'Health permit renewal',
    'Annual health permit renewal paperwork. One-time: pushes disabled (max_pushes = 0).',
    '[{"label":"Gather prior-year inspection reports"},{"label":"Submit renewal application to the county"},{"label":"File the new permit in the office binder"}]',
    false,
    'Food Safety', 'Managers',
    '{"kind":"once","date":"2027-03-01"}',
    0
  )
) as v(title, description, checklist, require_photo, cat_name, team_name, recurrence, max_pushes)
join cats  c on c.name = v.cat_name
join teams t on t.name = v.team_name;
