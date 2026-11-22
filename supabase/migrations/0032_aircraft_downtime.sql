-- Aircraft downtime: a group admin marks the aircraft unavailable for a period (maintenance, a defect, the
-- annual, anything else). Maintenance always takes precedence over bookings:
--
-- 1. every member of the group sees the period (table `aircraft_downtime`, readable by members);
-- 2. no new booking can overlap it (a rule on `bookings`, so it holds whatever screen or request made the
--    booking, and when two things happen at the same moment: both take the same group lock);
-- 3. adding a period cancels every confirmed booking that overlaps it, but only after the admin has seen the
--    list and confirmed it (`create_aircraft_downtime`: the first call, without confirmation, only reports what
--    would be cancelled; the confirming call must name the same bookings, so a booking made in between is shown
--    before anything is cancelled);
-- 4. each affected member gets ONE email listing their cancelled bookings, the reason and who cancelled. It is
--    queued directly, so it does not depend on the member's email choices (a cancelled booking matters), and
--    the usual "booking cancelled" email to the whole group is suppressed for these cancellations.
--
-- Removing a period (`remove_aircraft_downtime`) makes the aircraft bookable again; bookings that were cancelled
-- stay cancelled. Periods are never deleted (removed ones keep `removed_at`). The whole-group calendar feed
-- (`calendar_feed`, 0021/0030) now lists the periods; the own-bookings feed does not.
--
-- Additive for the app, but it changes how a booking is accepted: run it BEFORE pushing the matching code (the
-- old code shows the database's message if a booking is refused).

create table public.aircraft_downtime (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (reason in ('maintenance', 'defect', 'annual', 'other')),
  note text check (char_length(note) between 1 and 200),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id),
  check (ends_at > starts_at)
);

create index aircraft_downtime_group_idx on public.aircraft_downtime (group_id, starts_at);

alter table public.aircraft_downtime enable row level security;

-- Members of the group see its periods. Writes go through the two functions below.
create policy "members can view their group's unavailable periods"
  on public.aircraft_downtime for select
  using (public.is_group_member(group_id));

-- ------------------------------------------------------------------ no booking inside a period
create function public.bookings_block_downtime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  -- (a booking that ends before it starts is left to the table's own check)
  if new.status = 'confirmed' and new.ends_at > new.starts_at then
    -- The same lock create_aircraft_downtime takes, so a booking and a new period cannot slip past each other.
    perform pg_advisory_xact_lock(hashtextextended(new.group_id::text, 0));
    select d.reason into v_reason
    from public.aircraft_downtime d
    where d.group_id = new.group_id
      and d.removed_at is null
      and tstzrange(d.starts_at, d.ends_at) && tstzrange(new.starts_at, new.ends_at)
    limit 1;
    if found then
      raise exception 'aircraft_unavailable' using detail = v_reason, errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bookings_block_downtime() from public, anon, authenticated;

create trigger bookings_block_downtime
  before insert on public.bookings
  for each row execute function public.bookings_block_downtime();

-- ------------------------------------------------------------------------- adding a period
create function public.create_aircraft_downtime(
  p_group_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text,
  p_note text default null,
  p_confirm boolean default false,
  p_expected_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_list jsonb;
  v_ids uuid[];
  v_id uuid;
  v_cancelled integer := 0;
  v_emailed integer := 0;
begin
  if v_me is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_reason is null or p_reason not in ('maintenance', 'defect', 'annual', 'other') then
    return jsonb_build_object('result', 'reason_invalid');
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    return jsonb_build_object('result', 'note_too_long');
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_starts_at < timestamptz '2000-01-01' or p_ends_at > timestamptz '2100-01-01' then
    return jsonb_build_object('result', 'period_invalid');
  end if;
  if p_ends_at <= now() then
    return jsonb_build_object('result', 'period_past');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text, 0));

  -- The confirmed bookings that overlap the period (any overlap cancels the whole booking).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'who', coalesce(m.display_name, 'A member'),
           'starts_at', b.starts_at, 'ends_at', b.ends_at, 'note', b.note
         ) order by b.starts_at, b.id), '[]'::jsonb),
         coalesce(array_agg(b.id order by b.id), '{}'::uuid[])
  into v_list, v_ids
  from public.bookings b
  left join public.group_members m on m.group_id = b.group_id and m.user_id = b.member_id
  where b.group_id = p_group_id
    and b.status = 'confirmed'
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at);

  if cardinality(v_ids) > 0 then
    if not coalesce(p_confirm, false) then
      return jsonb_build_object('result', 'needs_confirmation', 'bookings', v_list);
    end if;
    -- The admin confirmed a particular list: if it is not the list now, show the new one first.
    if p_expected_ids is null
       or (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(p_expected_ids) as x) is distinct from v_ids then
      return jsonb_build_object('result', 'bookings_changed', 'bookings', v_list);
    end if;
  end if;

  insert into public.aircraft_downtime (group_id, starts_at, ends_at, reason, note, created_by)
  values (p_group_id, p_starts_at, p_ends_at, p_reason, v_note, v_me)
  returning id into v_id;

  if cardinality(v_ids) > 0 then
    -- These cancellations get one email per member (below), not one to the whole group per booking.
    perform set_config('blocktime.suppress_notifications', 'on', true);

    update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me
    where id = any (v_ids) and status = 'confirmed';
    get diagnostics v_cancelled = row_count;

    insert into public.notification_outbox (group_id, recipient_user_id, recipient_email, event, payload)
    select p_group_id, m.user_id, u.email, 'booking_unavailable',
           jsonb_build_object(
             'reason', p_reason,
             'note', v_note,
             'period_start', p_starts_at,
             'period_end', p_ends_at,
             'cancelled_by', public.notification_member_name(p_group_id, v_me),
             'bookings', x.list
           )
    from (
      select b.member_id,
             jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'note', b.note) order by b.starts_at, b.id) as list
      from public.bookings b
      where b.id = any (v_ids)
      group by b.member_id
    ) x
    join public.group_members m on m.group_id = p_group_id and m.user_id = x.member_id and m.removed_at is null
    join auth.users u on u.id = x.member_id and u.email is not null and u.email <> '';
    get diagnostics v_emailed = row_count;
  end if;

  return jsonb_build_object('result', 'ok', 'id', v_id, 'cancelled', v_cancelled, 'emailed', v_emailed);
end;
$$;

revoke all on function public.create_aircraft_downtime(uuid, timestamptz, timestamptz, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.create_aircraft_downtime(uuid, timestamptz, timestamptz, text, text, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------- removing a period
create function public.remove_aircraft_downtime(p_group_id uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.aircraft_downtime
  set removed_at = now(), removed_by = auth.uid()
  where id = p_id and group_id = p_group_id and removed_at is null;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.remove_aircraft_downtime(uuid, uuid) from public, anon;
grant execute on function public.remove_aircraft_downtime(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------- the calendar feed
-- As in 0030, with the group's unavailable periods added for a whole-group link (an own-bookings link gets none).
create or replace function public.calendar_feed(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_feed public.calendar_feeds%rowtype;
  v_group public.groups%rowtype;
begin
  if p_token is null or char_length(p_token) <> 64 then
    return null;
  end if;

  select * into v_feed from public.calendar_feeds f where f.token = p_token and f.revoked_at is null;
  if not found then
    return null;
  end if;
  if not exists (
    select 1 from public.group_members m
    where m.group_id = v_feed.group_id and m.user_id = v_feed.user_id and m.removed_at is null
  ) then
    return null;
  end if;

  select * into v_group from public.groups g where g.id = v_feed.group_id;

  return jsonb_build_object(
    'scope', v_feed.scope,
    'group_name', v_group.name,
    'group_slug', v_group.slug,
    'registration', v_group.aircraft_registration,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'note', b.note,
        'who', coalesce(m.display_name, 'A member'),
        'mine', b.member_id = v_feed.user_id,
        'created_at', b.created_at
      ) order by b.starts_at, b.id)
      from public.bookings b
      left join public.group_members m on m.group_id = b.group_id and m.user_id = b.member_id
      where b.group_id = v_feed.group_id
        and b.status = 'confirmed'
        and b.ends_at > now() - interval '60 days'
        and (v_feed.scope = 'all' or b.member_id = v_feed.user_id)
    ), '[]'::jsonb),
    'downtime', case when v_feed.scope = 'all' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'starts_at', d.starts_at,
        'ends_at', d.ends_at,
        'reason', d.reason,
        'note', d.note,
        'created_at', d.created_at
      ) order by d.starts_at, d.id)
      from public.aircraft_downtime d
      where d.group_id = v_feed.group_id
        and d.removed_at is null
        and d.ends_at > now() - interval '60 days'
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
