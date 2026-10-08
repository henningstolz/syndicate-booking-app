-- Clean-up of things nothing uses any more, plus one security gap.
--
-- 1. A GAP IN JOINING. Joining a group used to be possible with a direct insert
--    into group_members, allowed by a policy that only asked "does this group
--    have ANY open invite for that role?" It never checked which invite the
--    person held. So anyone who knew a group's id (it appears in the pages the
--    group's members see) could add themselves while an invite was open. The app
--    has joined people through accept_invite() since 0010, which does check the
--    invite; the old policy, the helper behind it (has_valid_invite) and the old
--    two-step helper (mark_invite_used) are removed. Creating a group and
--    becoming its first admin still works (the other policy, which the app uses).
--
-- 2. THE SHARED FUEL POT is gone since 0016: the cost_items table and its
--    functions are dropped (cost_expenses replaced them; cost_items only ever
--    held test entries), and cost_statement() stops returning its constant
--    fuel_pence keys.
--
-- Backwards compatible with the code that is live: it uses none of these. Try it
-- on the test project first (npm run db:migrate), then run it on the live one.

-- ---------------------------------------------------------------------------
-- 1. Joining only through accept_invite()
-- ---------------------------------------------------------------------------

drop policy "a user can join a group via a valid matching invite" on public.group_members;
drop function public.has_valid_invite(uuid, text);
drop function public.mark_invite_used(uuid);

-- ---------------------------------------------------------------------------
-- 2. The old fuel pot
-- ---------------------------------------------------------------------------

drop function public.add_cost_item(uuid, date, text, text, integer);
drop function public.void_cost_item(uuid, text);
drop function public.cost_month_flights(uuid, date, date, integer);
drop table public.cost_items;

-- The statement without the leftover fuel keys (otherwise as in 0016).
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
