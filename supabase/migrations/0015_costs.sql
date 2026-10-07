-- Hours and costs: a monthly statement per member.
--
-- The group's cost rule (as the syndicate shares costs today):
--   * a FIXED MONTHLY SHARE per member, a set amount decided in advance;
--   * an HOURLY RATE per block hour flown (block time = brakes off to brakes
--     on, as in the flight log);
--   * FUEL (and other shared costs) paid by the group, entered by admins as they
--     come and split between members by hours flown in the month.
--
-- * `cost_rates`: the fixed share and the hourly rate, each valid from a month.
--   Append-only: a new row for a month replaces the older one for that month and
--   later ones, and old rows stay as history. A statement uses the rates in
--   force for ITS month, so raising the rate never changes past statements.
-- * `cost_items`: shared costs (fuel, other). Never edited or deleted: an admin
--   voids a wrong one with a reason, like the flight log.
-- * `cost_statement()`: works out a month for the caller. An admin gets every
--   member and every flight; a member gets only their own, plus the month's
--   totals (fuel, hours) they need to understand it.
--
-- All money is whole pence. Fuel is allocated with the largest-remainder method,
-- so the members' fuel shares add up exactly to the fuel bill. A flight is
-- charged to its captain, or, for a guest captain, to the member who logged it.
--
-- Backwards compatible: run this BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- The first day of the month the rates start to apply.
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  monthly_fee_pence integer not null check (monthly_fee_pence between 0 and 10000000),
  hourly_rate_pence integer not null check (hourly_rate_pence between 0 and 10000000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index cost_rates_group_idx on public.cost_rates (group_id, effective_month desc, created_at desc);

alter table public.cost_rates enable row level security;

-- Members can see the rates they pay. Changing them goes through set_cost_rate().
create policy "members can view their group's cost rates"
  on public.cost_rates for select
  using (public.is_group_member(group_id));

create table public.cost_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  incurred_on date not null,
  category text not null check (category in ('fuel', 'other')),
  description text not null check (char_length(description) between 1 and 120),
  amount_pence integer not null check (amount_pence between 1 and 10000000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (char_length(void_reason) <= 300)
);

create index cost_items_group_idx on public.cost_items (group_id, incurred_on desc);

alter table public.cost_items enable row level security;

-- The individual receipts are for admins; members see the month's total in
-- their statement. Writes go through add_cost_item() and void_cost_item().
create policy "admins can view their group's cost items"
  on public.cost_items for select
  using (public.is_group_admin(group_id));

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Set the fixed monthly share and hourly rate from a month onwards.
create function public.set_cost_rate(
  p_group_id uuid,
  p_month date,
  p_fee_pence integer,
  p_hourly_pence integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_month < date '2000-01-01' or v_month > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  if p_fee_pence is null or p_hourly_pence is null
     or p_fee_pence < 0 or p_fee_pence > 10000000
     or p_hourly_pence < 0 or p_hourly_pence > 10000000 then
    return jsonb_build_object('result', 'amount_invalid');
  end if;

  insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by)
  values (p_group_id, v_month, p_fee_pence, p_hourly_pence, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Record a shared cost (fuel, or something else shared by hours).
create function public.add_cost_item(
  p_group_id uuid,
  p_date date,
  p_category text,
  p_description text,
  p_amount_pence integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := btrim(coalesce(p_description, ''));
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_category is null or p_category not in ('fuel', 'other') then
    return jsonb_build_object('result', 'category_invalid');
  end if;
  if v_description = '' then
    return jsonb_build_object('result', 'description_required');
  end if;
  if char_length(v_description) > 120 then
    return jsonb_build_object('result', 'description_too_long');
  end if;
  if p_amount_pence is null or p_amount_pence < 1 or p_amount_pence > 10000000 then
    return jsonb_build_object('result', 'amount_invalid');
  end if;
  if p_date is null or p_date < date '2000-01-01'
     or p_date > (now() at time zone 'Europe/London')::date + 1 then
    return jsonb_build_object('result', 'date_invalid');
  end if;

  insert into public.cost_items (group_id, incurred_on, category, description, amount_pence, created_by)
  values (p_group_id, p_date, p_category, v_description, p_amount_pence, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Take a wrong cost out of the statements, with a reason. It stays visible.
create function public.void_cost_item(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.cost_items%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_item from public.cost_items where id = p_id;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if auth.uid() is null or not public.is_group_admin(v_item.group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 300 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;

  update public.cost_items
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_id and voided_at is null;
  if not found then
    return jsonb_build_object('result', 'already_voided');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.set_cost_rate(uuid, date, integer, integer) from public, anon;
revoke all on function public.add_cost_item(uuid, date, text, text, integer) from public, anon;
revoke all on function public.void_cost_item(uuid, text) from public, anon;
grant execute on function public.set_cost_rate(uuid, date, integer, integer) to authenticated;
grant execute on function public.add_cost_item(uuid, date, text, text, integer) to authenticated;
grant execute on function public.void_cost_item(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The statement
-- ---------------------------------------------------------------------------

-- The month's flights, each charged to its captain (a guest captain's flight
-- goes to the member who logged it) at the hourly rate, as whole pence per
-- flight. Internal: used by cost_statement().
create function public.cost_month_flights(
  p_group_id uuid,
  p_start date,
  p_end date,
  p_hourly integer
)
returns table (
  id uuid,
  flight_date date,
  from_place text,
  to_place text,
  brakes_off timestamptz,
  charged uuid,
  tenths integer,
  pence integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.flight_date, f.from_place, f.to_place, f.brakes_off,
         coalesce(f.captain_id, f.created_by),
         (f.block_deci * 10)::integer,
         round(((f.block_deci * 10)::integer)::numeric * p_hourly / 10)::integer
  from public.flight_entries f
  where f.group_id = p_group_id
    and f.voided_at is null
    and f.flight_date >= p_start and f.flight_date < p_end;
$$;

revoke all on function public.cost_month_flights(uuid, date, date, integer) from public, anon, authenticated;

-- One month for the caller: {"result": "ok", "month", "rates", "fuel_pence",
-- "hours_tenths", "is_admin", "members": [...], "flights": [...]}.
-- Hours are in tenths (1.2 h = 12) so everything is whole numbers.
create function public.cost_statement(p_group_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_admin boolean;
  v_fee integer;
  v_hourly integer;
  v_missing boolean;
  v_fuel bigint;
  v_hours bigint;
  v_members jsonb;
  v_flights jsonb;
begin
  if v_me is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  v_admin := public.is_group_admin(p_group_id);

  -- The rates in force for this month: the latest row starting on or before it.
  select r.monthly_fee_pence, r.hourly_rate_pence into v_fee, v_hourly
  from public.cost_rates r
  where r.group_id = p_group_id and r.effective_month <= v_start
  order by r.effective_month desc, r.created_at desc
  limit 1;
  v_missing := not found;
  v_fee := coalesce(v_fee, 0);
  v_hourly := coalesce(v_hourly, 0);

  select coalesce(sum(c.amount_pence), 0) into v_fuel
  from public.cost_items c
  where c.group_id = p_group_id
    and c.voided_at is null
    and c.incurred_on >= v_start and c.incurred_on < v_end;

  select coalesce(sum(cf.tenths), 0) into v_hours
  from public.cost_month_flights(p_group_id, v_start, v_end, v_hourly) cf;

  with in_month as (
    select m.user_id, coalesce(m.display_name, 'Member') as name
    from public.group_members m
    where m.group_id = p_group_id
      and (m.created_at at time zone 'Europe/London')::date < v_end
      and (m.removed_at is null or (m.removed_at at time zone 'Europe/London')::date >= v_start)
  ),
  people as (
    select user_id, name, true as is_member from in_month
    union all
    select cf.charged, coalesce(max(gm.display_name), 'Member'), false
    from public.cost_month_flights(p_group_id, v_start, v_end, v_hourly) cf
    left join public.group_members gm on gm.group_id = p_group_id and gm.user_id = cf.charged
    where cf.charged not in (select user_id from in_month)
    group by cf.charged
  ),
  per_person as (
    select p.user_id, p.name, p.is_member,
           coalesce(sum(cf.tenths), 0)::integer as tenths,
           count(cf.id)::integer as flights,
           coalesce(sum(cf.pence), 0)::integer as hourly_pence,
           (count(*) over ())::integer as people_count
    from people p
    left join public.cost_month_flights(p_group_id, v_start, v_end, v_hourly) cf on cf.charged = p.user_id
    group by p.user_id, p.name, p.is_member
  ),
  exact as (
    select pp.*,
           case when v_hours > 0 then (v_fuel * pp.tenths)::numeric / v_hours
                else v_fuel::numeric / pp.people_count end as share
    from per_person pp
  ),
  floored as (
    select e.*, floor(e.share)::bigint as base, e.share - floor(e.share) as frac from exact e
  ),
  ranked as (
    select fl.*,
           row_number() over (order by fl.frac desc, fl.user_id) as rank,
           (v_fuel - sum(fl.base) over ())::integer as leftover
    from floored fl
  ),
  final as (
    select r.user_id, r.name, r.is_member, r.tenths, r.flights, r.hourly_pence,
           case when r.is_member then v_fee else 0 end as fixed_pence,
           (r.base + case when r.rank <= r.leftover then 1 else 0 end)::integer as fuel_pence
    from ranked r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', f.user_id,
      'name', f.name,
      'is_member', f.is_member,
      'flights', f.flights,
      'hours_tenths', f.tenths,
      'fixed_pence', f.fixed_pence,
      'hourly_pence', f.hourly_pence,
      'fuel_pence', f.fuel_pence,
      'total_pence', f.fixed_pence + f.hourly_pence + f.fuel_pence
    ) order by f.name, f.user_id), '[]'::jsonb)
  into v_members
  from final f
  where v_admin or f.user_id = v_me;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cf.id,
      'date', cf.flight_date,
      'from', cf.from_place,
      'to', cf.to_place,
      'user_id', cf.charged,
      'hours_tenths', cf.tenths,
      'pence', cf.pence
    ) order by cf.brakes_off, cf.id), '[]'::jsonb)
  into v_flights
  from public.cost_month_flights(p_group_id, v_start, v_end, v_hourly) cf
  where v_admin or cf.charged = v_me;

  return jsonb_build_object(
    'result', 'ok',
    'month', v_start,
    'is_admin', v_admin,
    'rates', jsonb_build_object('fee_pence', v_fee, 'hourly_pence', v_hourly, 'missing', v_missing),
    'fuel_pence', v_fuel,
    'hours_tenths', v_hours,
    'members', v_members,
    'flights', v_flights
  );
end;
$$;

revoke all on function public.cost_statement(uuid, date) from public, anon;
grant execute on function public.cost_statement(uuid, date) to authenticated;
