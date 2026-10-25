-- Platform foundations (beta readiness, phase A). Database only: nothing in the app reads
-- these tables yet, and billing is not enforced anywhere. It records, for every group, its
-- plan and billing dates, keeps an append-only history of every change a platform admin
-- makes, holds a few platform-wide settings, and records who accepted which terms.
--
-- Backwards compatible: new tables and functions only, no change to anything that exists.
-- Run it in the SQL editor in one go; it is a single transaction, so it applies completely
-- or not at all. After running it, group_plans must have one row per group (the last
-- statement checks that and undoes everything if not).
--
-- THE PLATFORM ADMIN. Nobody is a platform admin until you add them, by hand, once, in the
-- SQL editor (never from the app). Use your own sign-in address in place of the placeholder:
--
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'YOUR-EMAIL-HERE';
--
-- Even then, every admin_* function also needs a sign-in with a second factor (the session
-- token must say aal2), so they do nothing until the admin page and authenticator-app
-- sign-in exist.
--
-- WHO CAN DO WHAT.
--   * platform_admins, platform_settings, plan_events: no policy at all, no table rights for
--     the app's users. Reached only through the functions below.
--   * group_plans: a group's admins can READ their own group's row. Nobody writes it from the
--     app; the only way is admin_update_group_plan() (and the trigger that creates the row).
--   * terms_acceptances: a person can add and read their own rows.
--   * plan_events has no foreign keys on purpose: it is append-only (a trigger refuses every
--     update, delete and truncate), and a foreign key's cascade would be an update or delete.
--     Its history therefore outlives a deleted group. It holds ids, plan values and the
--     reason given, no names or emails.

-- ------------------------------------------------------------------ tables

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key check (key in (
    'billing_enforcement_enabled', 'default_plan_new_groups', 'default_cohort_new_groups',
    'paid_beta_cutoff', 'grace_period_days'
  )),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.platform_settings (key, value) values
  ('billing_enforcement_enabled', 'false'::jsonb),
  ('default_plan_new_groups', '"founding"'::jsonb),
  ('default_cohort_new_groups', '"founding-2026"'::jsonb),
  ('paid_beta_cutoff', 'null'::jsonb),
  ('grace_period_days', '14'::jsonb);

create table public.group_plans (
  group_id uuid primary key references public.groups (id) on delete cascade,
  plan text not null check (plan in ('founding', 'standard', 'complimentary')),
  billing_status text not null default 'none' check (billing_status in ('none', 'trial', 'active', 'past_due', 'cancelled')),
  cohort text check (char_length(cohort) between 1 and 40),
  trial_ends_at timestamptz,
  paid_until date,
  price_locked_until date,
  discount_percent integer check (discount_percent between 0 and 100),
  billing_reference text check (char_length(billing_reference) <= 200),
  -- Not used yet; room for a payment provider later.
  stripe_customer_id text check (char_length(stripe_customer_id) <= 200),
  stripe_subscription_id text check (char_length(stripe_subscription_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.plan_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid,
  actor_id uuid,
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('group_created', 'plan_changed', 'setting_changed')),
  old_values jsonb,
  new_values jsonb,
  reason text
);

create index plan_events_group_idx on public.plan_events (group_id, created_at desc);

create table public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  document text not null check (document in ('terms', 'privacy')),
  version text not null check (char_length(version) between 1 and 40),
  accepted_at timestamptz not null default now()
);

-- Accepting the same version twice (a double click) leaves a single row.
create unique index terms_acceptances_once
  on public.terms_acceptances (user_id, document, version, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ------------------------------------------------- append-only plan history

create function public.plan_events_refuse_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'plan_events is append-only: rows cannot be changed or removed';
end;
$$;

create trigger plan_events_no_update_delete
  before update or delete on public.plan_events
  for each row execute function public.plan_events_refuse_change();

create trigger plan_events_no_truncate
  before truncate on public.plan_events
  for each statement execute function public.plan_events_refuse_change();

-- ----------------------------------------------------- security: rows and rights

alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;
alter table public.group_plans enable row level security;
alter table public.plan_events enable row level security;
alter table public.terms_acceptances enable row level security;

-- Supabase hands new tables to the app's users automatically; take that back, then give
-- only what is meant.
revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.platform_settings from anon, authenticated;
revoke all on table public.group_plans from anon, authenticated;
revoke all on table public.plan_events from anon, authenticated;
revoke all on table public.terms_acceptances from anon, authenticated;

grant select on table public.group_plans to authenticated;
grant select, insert on table public.terms_acceptances to authenticated;

create policy "group admins can read their group's plan"
  on public.group_plans for select
  using (public.is_group_admin(group_id));

create policy "people can read their own acceptances"
  on public.terms_acceptances for select
  using (user_id = auth.uid());

create policy "people can record their own acceptance"
  on public.terms_acceptances for insert
  with check (
    user_id = auth.uid()
    and (group_id is null or public.is_group_member(group_id))
  );

-- ------------------------------------------------------ platform admin checks

-- True only for someone in platform_admins.
create function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- A platform admin whose sign-in used a second factor (the token's aal is aal2). Every
-- admin_* function starts with this.
create function public.platform_admin_ok()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.is_platform_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- The platform-wide settings, for the server-side check of what a group may do. Nothing in
-- them is personal.
create function public.get_platform_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  return jsonb_build_object(
    'result', 'ok',
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.platform_settings)
  );
end;
$$;

-- ----------------------------------------------------- new groups get a plan

-- Every new group gets its plan row (and a first history entry), whichever way it was
-- created. The defaults come from the settings; if a setting is missing or odd, the
-- founding defaults apply, so this can never stop a group from being created.
create function public.create_group_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_cohort text;
  v_cutoff date;
begin
  select value #>> '{}' into v_plan from public.platform_settings where key = 'default_plan_new_groups';
  select value #>> '{}' into v_cohort from public.platform_settings where key = 'default_cohort_new_groups';
  begin
    select (value #>> '{}')::date into v_cutoff from public.platform_settings where key = 'paid_beta_cutoff';
  exception when others then
    v_cutoff := null;
  end;
  if v_plan is null or v_plan not in ('founding', 'standard', 'complimentary') then
    v_plan := 'founding';
  end if;
  if v_cohort is null or char_length(v_cohort) not between 1 and 40 then
    v_cohort := 'founding-2026';
  end if;
  -- From the cut-off date on, new groups are ordinary (standard) groups.
  if v_cutoff is not null and current_date >= v_cutoff then
    v_plan := 'standard';
    v_cohort := null;
  end if;

  insert into public.group_plans (group_id, plan, cohort, billing_status)
  values (new.id, v_plan, v_cohort, 'none')
  on conflict (group_id) do nothing;

  insert into public.plan_events (group_id, actor_id, event_type, new_values, reason)
  values (
    new.id, auth.uid(), 'group_created',
    jsonb_build_object('plan', v_plan, 'cohort', v_cohort, 'billing_status', 'none'),
    'group created'
  );
  return new;
end;
$$;

revoke all on function public.create_group_plan() from public, anon, authenticated;
revoke all on function public.plan_events_refuse_change() from public, anon, authenticated;

create trigger groups_create_plan
  after insert on public.groups
  for each row execute function public.create_group_plan();

-- --------------------------------------------------------------- admin functions

-- One row per group with metadata only. Never bookings, flight log or cost content, and
-- no email addresses except the group admins'.
create function public.admin_list_groups()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.platform_admin_ok() then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  return jsonb_build_object('result', 'ok', 'groups', (
    select coalesce(jsonb_agg(x.row order by x.created_at desc), '[]'::jsonb)
    from (
      select g.created_at, jsonb_build_object(
        'group_id', g.id,
        'slug', g.slug,
        'name', g.name,
        'created_at', g.created_at,
        -- One aircraft per group for now (its details are columns on groups).
        'aircraft_count', 1,
        'member_count', (select count(*) from public.group_members m where m.group_id = g.id and m.removed_at is null),
        'admins', (
          select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'email', u.email) order by m.created_at), '[]'::jsonb)
          from public.group_members m
          join auth.users u on u.id = m.user_id
          where m.group_id = g.id and m.role = 'admin' and m.removed_at is null
        ),
        'last_activity', greatest(
          (select max(b.created_at) from public.bookings b where b.group_id = g.id),
          (select max(f.created_at) from public.flight_entries f where f.group_id = g.id)
        ),
        'plan', gp.plan,
        'billing_status', gp.billing_status,
        'cohort', gp.cohort,
        'trial_ends_at', gp.trial_ends_at,
        'paid_until', gp.paid_until,
        'price_locked_until', gp.price_locked_until,
        'discount_percent', gp.discount_percent,
        'billing_reference', gp.billing_reference,
        'stripe_customer_id', gp.stripe_customer_id,
        'stripe_subscription_id', gp.stripe_subscription_id,
        'plan_updated_at', gp.updated_at
      ) as row
      from public.groups g
      left join public.group_plans gp on gp.group_id = g.id
    ) x
  ));
end;
$$;

-- Changes some of a group's plan fields (p_changes is a json object of field: value) and
-- writes the history entry in the same transaction. A reason is required.
create function public.admin_update_group_plan(p_group_id uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_allowed text[] := array['plan', 'billing_status', 'cohort', 'trial_ends_at', 'paid_until',
    'price_locked_until', 'discount_percent', 'billing_reference', 'stripe_customer_id', 'stripe_subscription_id'];
  v_old public.group_plans;
  v_new public.group_plans;
  v_old_j jsonb;
  v_new_j jsonb;
  v_key text;
  v_val jsonb;
  v_old_changed jsonb := '{}'::jsonb;
  v_new_changed jsonb := '{}'::jsonb;
begin
  if not public.platform_admin_ok() then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    return jsonb_build_object('result', 'changes_invalid');
  end if;
  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if not (v_key = any (v_allowed)) then
      return jsonb_build_object('result', 'field_unknown', 'field', v_key);
    end if;
    -- Each field takes only its own kind of value, and dates only as written 2026-12-31
    -- (Postgres would also accept words like "tomorrow").
    if jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if v_key = 'discount_percent' then
      if jsonb_typeof(v_val) <> 'number' then
        return jsonb_build_object('result', 'invalid', 'field', v_key);
      end if;
    elsif jsonb_typeof(v_val) <> 'string' then
      return jsonb_build_object('result', 'invalid', 'field', v_key);
    elsif v_key in ('paid_until', 'price_locked_until') and (v_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
      return jsonb_build_object('result', 'invalid', 'field', v_key);
    elsif v_key = 'trial_ends_at' and (v_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}([T ].*)?$' then
      return jsonb_build_object('result', 'invalid', 'field', v_key);
    end if;
  end loop;

  select * into v_old from public.group_plans where group_id = p_group_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  begin
    -- Lays the changes over the current row; a wrong type or date fails here, a wrong value
    -- (unknown plan, discount over 100) fails on the update's checks.
    v_new := jsonb_populate_record(v_old, p_changes);
    v_old_j := to_jsonb(v_old);
    v_new_j := to_jsonb(v_new);
    for v_key in select unnest(v_allowed) loop
      if v_old_j -> v_key is distinct from v_new_j -> v_key then
        v_old_changed := v_old_changed || jsonb_build_object(v_key, v_old_j -> v_key);
        v_new_changed := v_new_changed || jsonb_build_object(v_key, v_new_j -> v_key);
      end if;
    end loop;
    if v_new_changed = '{}'::jsonb then
      return jsonb_build_object('result', 'no_change');
    end if;
    update public.group_plans set
      plan = v_new.plan,
      billing_status = v_new.billing_status,
      cohort = v_new.cohort,
      trial_ends_at = v_new.trial_ends_at,
      paid_until = v_new.paid_until,
      price_locked_until = v_new.price_locked_until,
      discount_percent = v_new.discount_percent,
      billing_reference = v_new.billing_reference,
      stripe_customer_id = v_new.stripe_customer_id,
      stripe_subscription_id = v_new.stripe_subscription_id,
      updated_at = now(),
      updated_by = auth.uid()
    where group_id = p_group_id;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow or numeric_value_out_of_range or not_null_violation
      or string_data_right_truncation then
      return jsonb_build_object('result', 'invalid');
  end;

  insert into public.plan_events (group_id, actor_id, event_type, old_values, new_values, reason)
  values (p_group_id, auth.uid(), 'plan_changed', v_old_changed, v_new_changed, v_reason);
  return jsonb_build_object('result', 'ok', 'changed', (select jsonb_agg(k) from jsonb_object_keys(v_new_changed) k));
end;
$$;

-- Changes one platform-wide setting, with the same history entry.
create function public.admin_update_setting(p_key text, p_value jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_value jsonb := coalesce(p_value, 'null'::jsonb);
  v_old jsonb;
  v_text text;
begin
  if not public.platform_admin_ok() then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;
  if p_key is null or p_key not in ('billing_enforcement_enabled', 'default_plan_new_groups',
      'default_cohort_new_groups', 'paid_beta_cutoff', 'grace_period_days') then
    return jsonb_build_object('result', 'field_unknown');
  end if;

  -- What each setting may hold.
  begin
    if p_key = 'billing_enforcement_enabled' then
      if jsonb_typeof(v_value) <> 'boolean' then raise exception 'invalid'; end if;
    elsif p_key = 'default_plan_new_groups' then
      if jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') not in ('founding', 'standard', 'complimentary') then raise exception 'invalid'; end if;
    elsif p_key = 'default_cohort_new_groups' then
      if jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') not between 1 and 40 then raise exception 'invalid'; end if;
    elsif p_key = 'paid_beta_cutoff' then
      if jsonb_typeof(v_value) <> 'null' then
        v_text := v_value #>> '{}';
        if jsonb_typeof(v_value) <> 'string' or v_text !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid'; end if;
        perform v_text::date;
      end if;
    elsif p_key = 'grace_period_days' then
      if jsonb_typeof(v_value) <> 'number' or (v_value #>> '{}')::numeric <> floor((v_value #>> '{}')::numeric)
         or (v_value #>> '{}')::numeric not between 0 and 365 then raise exception 'invalid'; end if;
    end if;
  exception when others then
    return jsonb_build_object('result', 'invalid');
  end;

  select value into v_old from public.platform_settings where key = p_key for update;
  if v_old is not distinct from v_value then
    return jsonb_build_object('result', 'no_change');
  end if;
  update public.platform_settings set value = v_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  insert into public.plan_events (group_id, actor_id, event_type, old_values, new_values, reason)
  values (null, auth.uid(), 'setting_changed', jsonb_build_object(p_key, v_old), jsonb_build_object(p_key, v_value), v_reason);
  return jsonb_build_object('result', 'ok');
end;
$$;

-- The history for one group (or, with no group, for the platform-wide settings), newest first.
create function public.admin_list_plan_events(p_group_id uuid default null, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.platform_admin_ok() then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  return jsonb_build_object('result', 'ok', 'events', (
    select coalesce(jsonb_agg(x.event order by x.created_at desc), '[]'::jsonb)
    from (
      select e.created_at, jsonb_build_object(
        'id', e.id, 'group_id', e.group_id, 'created_at', e.created_at, 'event_type', e.event_type,
        'old_values', e.old_values, 'new_values', e.new_values, 'reason', e.reason,
        'actor_email', (select u.email from auth.users u where u.id = e.actor_id)
      ) as event
      from public.plan_events e
      where e.group_id is not distinct from p_group_id
      order by e.created_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ));
end;
$$;

-- Who may run what: signed-in users only (each function checks for itself who they are).
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.platform_admin_ok() from public, anon;
revoke all on function public.get_platform_settings() from public, anon;
revoke all on function public.admin_list_groups() from public, anon;
revoke all on function public.admin_update_group_plan(uuid, jsonb, text) from public, anon;
revoke all on function public.admin_update_setting(text, jsonb, text) from public, anon;
revoke all on function public.admin_list_plan_events(uuid, integer) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_admin_ok() to authenticated;
grant execute on function public.get_platform_settings() to authenticated;
grant execute on function public.admin_list_groups() to authenticated;
grant execute on function public.admin_update_group_plan(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_update_setting(text, jsonb, text) to authenticated;
grant execute on function public.admin_list_plan_events(uuid, integer) to authenticated;

-- ------------------------------------------------------ existing groups

-- Every group that exists now becomes a founding group (the trigger above covers new ones).
insert into public.group_plans (group_id, plan, cohort, billing_status)
select g.id, 'founding', 'founding-2026', 'none'
from public.groups g
on conflict (group_id) do nothing;

insert into public.plan_events (group_id, actor_id, event_type, new_values, reason)
select g.id, null, 'group_created',
  jsonb_build_object('plan', 'founding', 'cohort', 'founding-2026', 'billing_status', 'none'),
  'backfill'
from public.groups g
where not exists (select 1 from public.plan_events e where e.group_id = g.id and e.event_type = 'group_created');

-- Safety check: one plan row per group, or none of this happens.
do $$
begin
  if (select count(*) from public.groups) <> (select count(*) from public.group_plans) then
    raise exception 'group_plans does not have exactly one row per group';
  end if;
end;
$$;
