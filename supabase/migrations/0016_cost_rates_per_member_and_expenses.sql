-- Costs, second version: how the syndicate really shares costs.
--
-- Changes from 0015:
--   * There is NO shared fuel pot any more. The statement is: the member's
--     fixed monthly share + block hours x their hourly rate - expenses they paid.
--   * Rates can be set PER MEMBER, on top of the group's default rates: a member
--     can have their own fixed share (0 = none) and/or their own hourly rate.
--     A part left empty follows the group's rate. Each member's own rates have
--     a history like the group's (valid from a month; the newest row wins).
--   * EXPENSES: when a member pays for something out of pocket (for example fuel
--     bought at another airfield), an admin records it as paid by that member
--     and it is credited on that member's statement for the month of its date.
--     Never edited: voided with a reason, like everything else.
--
-- Backwards compatible with the page that is live when this is run: the old
-- table `cost_items` and the functions add_cost_item / void_cost_item / the old
-- helper are left in place (the new code ignores them), and cost_statement()
-- still returns a `fuel_pence` of 0. A later clean-up migration removes them.
--
-- Run this BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- Rates per member
-- ---------------------------------------------------------------------------

alter table public.cost_rates
  add column user_id uuid references auth.users (id);

-- A member's own row may leave a part empty (= follow the group's rate); a
-- group row must have both.
alter table public.cost_rates alter column monthly_fee_pence drop not null;
alter table public.cost_rates alter column hourly_rate_pence drop not null;
alter table public.cost_rates
  add constraint cost_rates_group_rows_complete check (
    user_id is not null
    or (monthly_fee_pence is not null and hourly_rate_pence is not null)
  );

create index cost_rates_member_idx
  on public.cost_rates (group_id, user_id, effective_month desc, created_at desc);

-- Members see the group's rates and their OWN individual rates, never anybody
-- else's; admins see all.
drop policy "members can view their group's cost rates" on public.cost_rates;
create policy "members can view the group's rates and their own"
  on public.cost_rates for select
  using (
    public.is_group_admin(group_id)
    or (public.is_group_member(group_id) and (user_id is null or user_id = auth.uid()))
  );

-- Set one member's own fixed share and/or hourly rate from a month onwards.
-- An empty (null) part follows the group's rate; 0 is a real zero.
create function public.set_member_cost_rate(
  p_group_id uuid,
  p_user_id uuid,
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
  if p_user_id is null or not exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = p_user_id and m.removed_at is null
  ) then
    return jsonb_build_object('result', 'member_invalid');
  end if;
  if (p_fee_pence is not null and (p_fee_pence < 0 or p_fee_pence > 10000000))
     or (p_hourly_pence is not null and (p_hourly_pence < 0 or p_hourly_pence > 10000000)) then
    return jsonb_build_object('result', 'amount_invalid');
  end if;

  insert into public.cost_rates (group_id, user_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by)
  values (p_group_id, p_user_id, v_month, p_fee_pence, p_hourly_pence, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.set_member_cost_rate(uuid, uuid, date, integer, integer) from public, anon;
grant execute on function public.set_member_cost_rate(uuid, uuid, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Expenses a member paid, credited on their statement
-- ---------------------------------------------------------------------------

create table public.cost_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  paid_by uuid not null references auth.users (id),
  incurred_on date not null,
  description text not null check (char_length(description) between 1 and 120),
  amount_pence integer not null check (amount_pence between 1 and 10000000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (char_length(void_reason) <= 300)
);

create index cost_expenses_group_idx on public.cost_expenses (group_id, incurred_on desc);

alter table public.cost_expenses enable row level security;

-- Admins see every expense; a member sees the ones they paid themselves.
-- Writes go through add_cost_expense() and void_cost_expense().
create policy "admins and the payer can view expenses"
  on public.cost_expenses for select
  using (
    public.is_group_admin(group_id)
    or (public.is_group_member(group_id) and paid_by = auth.uid())
  );

create function public.add_cost_expense(
  p_group_id uuid,
  p_paid_by uuid,
  p_date date,
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
  if p_paid_by is null or not exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = p_paid_by and m.removed_at is null
  ) then
    return jsonb_build_object('result', 'member_invalid');
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

  insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by)
  values (p_group_id, p_paid_by, p_date, v_description, p_amount_pence, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

create function public.void_cost_expense(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.cost_expenses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_expense from public.cost_expenses where id = p_id;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if auth.uid() is null or not public.is_group_admin(v_expense.group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 300 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;

  update public.cost_expenses
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_id and voided_at is null;
  if not found then
    return jsonb_build_object('result', 'already_voided');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.add_cost_expense(uuid, uuid, date, text, integer) from public, anon;
revoke all on function public.void_cost_expense(uuid, text) from public, anon;
grant execute on function public.add_cost_expense(uuid, uuid, date, text, integer) to authenticated;
grant execute on function public.void_cost_expense(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The statement, new rule
--   total = fixed monthly share + sum of flight charges - expenses paid
-- where a member's fixed share and hourly rate are their own if set, otherwise
-- the group's. A flight is charged to its captain (for a guest captain, to the
-- member who logged it) at THAT member's hourly rate, rounded half up to a
-- whole penny per flight.
-- ---------------------------------------------------------------------------

create or replace function public.cost_statement(p_group_id uuid, p_month date)
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
  v_result jsonb;
begin
  if v_me is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  v_admin := public.is_group_admin(p_group_id);

  -- The group's rates in force for this month: the latest row (without a
  -- member) starting on or before it.
  select r.monthly_fee_pence, r.hourly_rate_pence into v_fee, v_hourly
  from public.cost_rates r
  where r.group_id = p_group_id and r.user_id is null and r.effective_month <= v_start
  order by r.effective_month desc, r.created_at desc
  limit 1;
  v_missing := not found;
  v_fee := coalesce(v_fee, 0);
  v_hourly := coalesce(v_hourly, 0);

  with raw_flights as (
    select f.id, f.flight_date, f.from_place, f.to_place, f.brakes_off,
           coalesce(f.captain_id, f.created_by) as charged,
           (f.block_deci * 10)::integer as tenths
    from public.flight_entries f
    where f.group_id = p_group_id
      and f.voided_at is null
      and f.flight_date >= v_start and f.flight_date < v_end
  ),
  expense_rows as (
    select e.id, e.incurred_on, e.description, e.paid_by, e.amount_pence
    from public.cost_expenses e
    where e.group_id = p_group_id
      and e.voided_at is null
      and e.incurred_on >= v_start and e.incurred_on < v_end
  ),
  in_month as (
    select m.user_id, coalesce(m.display_name, 'Member') as name
    from public.group_members m
    where m.group_id = p_group_id
      and (m.created_at at time zone 'Europe/London')::date < v_end
      and (m.removed_at is null or (m.removed_at at time zone 'Europe/London')::date >= v_start)
  ),
  involved as (
    select user_id, name, true as is_member from in_month
    union all
    select x.user_id, coalesce(max(gm.display_name), 'Member'), false
    from (select charged as user_id from raw_flights union select paid_by from expense_rows) x
    left join public.group_members gm on gm.group_id = p_group_id and gm.user_id = x.user_id
    where x.user_id not in (select user_id from in_month)
    group by x.user_id
  ),
  rated as (
    select i.user_id, i.name, i.is_member,
           coalesce(own.f, v_fee) as fee,
           coalesce(own.h, v_hourly) as hourly,
           (own.f is not null or own.h is not null) as custom
    from involved i
    left join lateral (
      select r.monthly_fee_pence as f, r.hourly_rate_pence as h
      from public.cost_rates r
      where r.group_id = p_group_id and r.user_id = i.user_id and r.effective_month <= v_start
      order by r.effective_month desc, r.created_at desc
      limit 1
    ) own on true
  ),
  priced as (
    select rf.id, rf.flight_date, rf.from_place, rf.to_place, rf.brakes_off, rf.charged, rf.tenths,
           round(rf.tenths::numeric * rt.hourly / 10)::integer as pence
    from raw_flights rf
    join rated rt on rt.user_id = rf.charged
  ),
  per_person as (
    select rt.user_id, rt.name, rt.is_member, rt.fee, rt.hourly, rt.custom,
           coalesce(sum(pr.tenths), 0)::integer as tenths,
           count(pr.id)::integer as flights,
           coalesce(sum(pr.pence), 0)::integer as hourly_pence
    from rated rt
    left join priced pr on pr.charged = rt.user_id
    group by rt.user_id, rt.name, rt.is_member, rt.fee, rt.hourly, rt.custom
  ),
  credits as (
    select paid_by as user_id, sum(amount_pence)::integer as pence
    from expense_rows
    group by paid_by
  ),
  final as (
    select pp.user_id, pp.name, pp.is_member, pp.fee, pp.hourly, pp.custom, pp.tenths, pp.flights,
           pp.hourly_pence,
           case when pp.is_member then pp.fee else 0 end as fixed_pence,
           coalesce(c.pence, 0) as credit_pence
    from per_person pp
    left join credits c on c.user_id = pp.user_id
  )
  select jsonb_build_object(
    'result', 'ok',
    'month', v_start,
    'is_admin', v_admin,
    'rates', jsonb_build_object('fee_pence', v_fee, 'hourly_pence', v_hourly, 'missing', v_missing),
    'hours_tenths', (select coalesce(sum(tenths), 0) from raw_flights),
    'credits_pence', (select coalesce(sum(amount_pence), 0) from expense_rows),
    -- Kept at 0 only so the page that was live before this migration keeps working.
    'fuel_pence', 0,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', f.user_id,
        'name', f.name,
        'is_member', f.is_member,
        'flights', f.flights,
        'hours_tenths', f.tenths,
        'fee_pence', f.fee,
        'hourly_rate_pence', f.hourly,
        'custom_rates', f.custom,
        'fixed_pence', f.fixed_pence,
        'hourly_pence', f.hourly_pence,
        'credit_pence', f.credit_pence,
        'fuel_pence', 0,
        'total_pence', f.fixed_pence + f.hourly_pence - f.credit_pence
      ) order by f.name, f.user_id), '[]'::jsonb)
      from final f
      where v_admin or f.user_id = v_me
    ),
    'flights', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'date', pr.flight_date,
        'from', pr.from_place,
        'to', pr.to_place,
        'user_id', pr.charged,
        'hours_tenths', pr.tenths,
        'pence', pr.pence
      ) order by pr.brakes_off, pr.id), '[]'::jsonb)
      from priced pr
      where v_admin or pr.charged = v_me
    ),
    'expenses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', er.id,
        'date', er.incurred_on,
        'description', er.description,
        'user_id', er.paid_by,
        'pence', er.amount_pence
      ) order by er.incurred_on, er.id), '[]'::jsonb)
      from expense_rows er
      where v_admin or er.paid_by = v_me
    )
  ) into v_result;

  return v_result;
end;
$$;
