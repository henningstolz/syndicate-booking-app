-- Digital flight log (the paper Technical Log, one entry per flight).
--
-- * `flight_entries`: who flew, from/to, category, fuel and oil, and the four
--   clock times (brakes off, airborne, landed, brakes on). Block and flight
--   time, and their decimal-hour equivalents, are calculated by the database
--   so every screen and report agrees.
-- * The airframe's total hours and the hours left to the next check are kept
--   on `groups` and recalculated whenever an entry is added or voided.
-- * Nobody edits or deletes an entry (like paper): a mistake is voided by an
--   admin with a reason and the pilot enters it again. Voided entries stay
--   visible but do not count.
-- * All writes go through SECURITY DEFINER functions that validate the entry
--   and return a result like {"result": "ok"} / {"result": "overlap"}.
--
-- Backwards compatible: run this BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- Hours bookkeeping on the group
-- ---------------------------------------------------------------------------

alter table public.groups
  -- Airframe hours BEFORE the first logged flight; total = baseline + flights.
  add column airframe_hours_baseline numeric(8,1),
  -- Cached current total, recalculated from the baseline and the log.
  add column airframe_total_hours numeric(8,1),
  -- The check limit as an absolute figure ("or at 5892.9 hours").
  add column next_check_at_hours numeric(8,1);

-- Minutes to decimal hours the way the paper conversion table does it:
-- minutes / 60 rounded to one decimal, halves up (15' = .3, 20' = .3, 45' = .8,
-- 50' = .8, 60' = 1.0).
create function public.minutes_to_deci(p_minutes numeric)
returns numeric
language sql
immutable
as $$
  select round(p_minutes / 6) / 10;
$$;

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

create table public.flight_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,

  -- UK date of brakes off.
  flight_date date not null,
  from_place text not null check (char_length(from_place) between 1 and 40),
  to_place text not null check (char_length(to_place) between 1 and 40),
  -- PV private, TG training, PT public transport.
  flight_category text not null check (flight_category in ('PV', 'TG', 'PT')),

  -- A group member, or null for a guest whose name is only in captain_name.
  captain_id uuid references auth.users (id),
  captain_name text not null check (char_length(captain_name) between 1 and 60),

  -- Fuel in each tank at departure (US gallons) and oil level (US quarts).
  fuel_left_usg numeric(5,1) not null check (fuel_left_usg between 0 and 100),
  fuel_right_usg numeric(5,1) not null check (fuel_right_usg between 0 and 100),
  oil_qt numeric(4,1) not null check (oil_qt between 0 and 20),

  brakes_off timestamptz not null,
  airborne timestamptz not null,
  landed timestamptz not null,
  brakes_on timestamptz not null,

  -- Calculated. Block time (brakes off to on) is for cost sharing; flight
  -- time (airborne to landed) drives the airframe hours.
  block_minutes integer generated always as (
    (extract(epoch from (brakes_on - brakes_off)) / 60)::integer
  ) stored,
  flight_minutes integer generated always as (
    (extract(epoch from (landed - airborne)) / 60)::integer
  ) stored,
  block_deci numeric(4,1) generated always as (
    public.minutes_to_deci(((extract(epoch from (brakes_on - brakes_off)) / 60)::integer)::numeric)
  ) stored,
  flight_deci numeric(4,1) generated always as (
    public.minutes_to_deci(((extract(epoch from (landed - airborne)) / 60)::integer)::numeric)
  ) stored,

  defects text check (char_length(defects) <= 2000),

  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),

  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (char_length(void_reason) <= 300),

  check (brakes_off <= airborne and airborne <= landed and landed <= brakes_on),
  check (brakes_on > brakes_off),

  -- One aircraft per group cannot be in two flights at once; also catches a
  -- double tap on the submit button. Voided entries do not block.
  exclude using gist (
    group_id with =,
    tstzrange (brakes_off, brakes_on) with &&
  ) where (voided_at is null)
);

create index flight_entries_group_time_idx
  on public.flight_entries (group_id, brakes_off desc);

alter table public.flight_entries enable row level security;

-- Members read their group's log. There are deliberately NO insert, update or
-- delete policies: every change goes through the functions below.
create policy "members can view their group's flight log"
  on public.flight_entries for select
  using (public.is_group_member(group_id));

-- ---------------------------------------------------------------------------
-- Totals
-- ---------------------------------------------------------------------------

-- Internal helper: recompute the cached total and hours-to-check from the
-- baseline and the (non-voided) log. Not callable from the app.
create function public.recalc_airframe_hours(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flown numeric;
begin
  select coalesce(sum(flight_deci), 0) into v_flown
  from public.flight_entries
  where group_id = p_group_id and voided_at is null;

  update public.groups g
  set
    airframe_total_hours = case
      when g.airframe_hours_baseline is null then null
      else g.airframe_hours_baseline + v_flown
    end,
    -- With a baseline and a check limit the remaining hours are derived;
    -- otherwise the manually entered figure stays as it is.
    hours_to_next_check = case
      when g.airframe_hours_baseline is not null and g.next_check_at_hours is not null
        then g.next_check_at_hours - (g.airframe_hours_baseline + v_flown)
      else g.hours_to_next_check
    end
  where g.id = p_group_id;
end;
$$;

revoke all on function public.recalc_airframe_hours(uuid) from public, anon, authenticated;

-- Admin: "the airframe has this many hours right now, and its next check is
-- at this many hours". Sets the baseline so that baseline + logged flights
-- equals the figure given.
create function public.set_airframe_hours(
  p_group_id uuid,
  p_total_hours numeric,
  p_next_check_at numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flown numeric;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_total_hours is null or p_total_hours < 0 or p_total_hours > 99999 then
    return jsonb_build_object('result', 'hours_invalid');
  end if;
  if p_next_check_at is not null and (p_next_check_at < 0 or p_next_check_at > 99999) then
    return jsonb_build_object('result', 'hours_invalid');
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  select coalesce(sum(flight_deci), 0) into v_flown
  from public.flight_entries
  where group_id = p_group_id and voided_at is null;

  update public.groups
  set airframe_hours_baseline = round(p_total_hours - v_flown, 1),
      next_check_at_hours = round(p_next_check_at, 1)
  where id = p_group_id;

  perform public.recalc_airframe_hours(p_group_id);
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- Adding and voiding entries
-- ---------------------------------------------------------------------------

create function public.add_flight_entry(
  p_group_id uuid,
  p_from text,
  p_to text,
  p_category text,
  p_captain_id uuid,
  p_captain_name text,
  p_fuel_left numeric,
  p_fuel_right numeric,
  p_oil numeric,
  p_brakes_off timestamptz,
  p_airborne timestamptz,
  p_landed timestamptz,
  p_brakes_on timestamptz,
  p_defects text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_from text := upper(btrim(coalesce(p_from, '')));
  v_to text := upper(btrim(coalesce(p_to, '')));
  v_defects text := nullif(btrim(coalesce(p_defects, '')), '');
  v_captain_name text;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  if v_from = '' or v_to = '' then
    return jsonb_build_object('result', 'place_required');
  end if;
  if char_length(v_from) > 40 or char_length(v_to) > 40 then
    return jsonb_build_object('result', 'place_too_long');
  end if;
  if p_category is null or p_category not in ('PV', 'TG', 'PT') then
    return jsonb_build_object('result', 'category_invalid');
  end if;

  -- The captain is a current member (name taken from their membership) or a
  -- named guest.
  if p_captain_id is not null then
    select coalesce(display_name, 'Member') into v_captain_name
    from public.group_members
    where group_id = p_group_id and user_id = p_captain_id and removed_at is null;
    if not found then
      return jsonb_build_object('result', 'captain_invalid');
    end if;
  else
    v_captain_name := btrim(coalesce(p_captain_name, ''));
    if v_captain_name = '' then
      return jsonb_build_object('result', 'captain_required');
    end if;
    if char_length(v_captain_name) > 60 then
      return jsonb_build_object('result', 'captain_invalid');
    end if;
  end if;

  if p_fuel_left is null or p_fuel_right is null
     or p_fuel_left < 0 or p_fuel_left > 100
     or p_fuel_right < 0 or p_fuel_right > 100 then
    return jsonb_build_object('result', 'fuel_invalid');
  end if;
  if p_oil is null or p_oil < 0 or p_oil > 20 then
    return jsonb_build_object('result', 'oil_invalid');
  end if;

  if p_brakes_off is null or p_airborne is null or p_landed is null or p_brakes_on is null
     or not (p_brakes_off <= p_airborne and p_airborne <= p_landed
             and p_landed <= p_brakes_on and p_brakes_on > p_brakes_off) then
    return jsonb_build_object('result', 'times_order');
  end if;
  if p_brakes_on - p_brakes_off > interval '16 hours' then
    return jsonb_build_object('result', 'too_long');
  end if;
  if p_brakes_off > now() + interval '2 hours' then
    return jsonb_build_object('result', 'in_future');
  end if;

  if v_defects is not null and char_length(v_defects) > 2000 then
    return jsonb_build_object('result', 'defects_too_long');
  end if;

  -- Serialise log changes within a group (and the totals that follow).
  perform 1 from public.groups where id = p_group_id for update;

  begin
    insert into public.flight_entries (
      id, group_id, flight_date, from_place, to_place, flight_category,
      captain_id, captain_name, fuel_left_usg, fuel_right_usg, oil_qt,
      brakes_off, airborne, landed, brakes_on, defects, created_by
    ) values (
      v_id, p_group_id, (p_brakes_off at time zone 'Europe/London')::date,
      v_from, v_to, p_category,
      p_captain_id, v_captain_name, round(p_fuel_left, 1), round(p_fuel_right, 1), round(p_oil, 1),
      date_trunc('minute', p_brakes_off), date_trunc('minute', p_airborne),
      date_trunc('minute', p_landed), date_trunc('minute', p_brakes_on),
      v_defects, auth.uid()
    );
  exception
    when exclusion_violation then
      return jsonb_build_object('result', 'overlap');
    when check_violation then
      return jsonb_build_object('result', 'times_order');
  end;

  perform public.recalc_airframe_hours(p_group_id);
  return jsonb_build_object('result', 'ok', 'id', v_id);
end;
$$;

-- Admin: take an entry out of the totals, with a reason. The entry stays
-- visible, marked void.
create function public.void_flight_entry(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.flight_entries%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_entry from public.flight_entries where id = p_entry_id;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if auth.uid() is null or not public.is_group_admin(v_entry.group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if char_length(v_reason) < 3 then
    return jsonb_build_object('result', 'reason_required');
  end if;
  if char_length(v_reason) > 300 then
    return jsonb_build_object('result', 'reason_too_long');
  end if;

  perform 1 from public.groups where id = v_entry.group_id for update;

  update public.flight_entries
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_entry_id and voided_at is null;
  if not found then
    return jsonb_build_object('result', 'already_voided');
  end if;

  perform public.recalc_airframe_hours(v_entry.group_id);
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.set_airframe_hours(uuid, numeric, numeric) from public, anon;
revoke all on function public.add_flight_entry(uuid, text, text, text, uuid, text, numeric, numeric, numeric, timestamptz, timestamptz, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.void_flight_entry(uuid, text) from public, anon;

grant execute on function public.set_airframe_hours(uuid, numeric, numeric) to authenticated;
grant execute on function public.add_flight_entry(uuid, text, text, text, uuid, text, numeric, numeric, numeric, timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.void_flight_entry(uuid, text) to authenticated;
