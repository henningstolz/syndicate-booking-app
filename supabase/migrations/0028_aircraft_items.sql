-- Aircraft equipment items that each group can customise: a name and a due date each
-- (life raft, life vests, fire extinguisher, first aid kit, or whatever the group adds).
--
-- * `aircraft_items` replaces the fixed columns groups.life_raft_due, life_vests_due and
--   fire_extinguisher_due. Group members read the list; group admins add, rename, change the date of
--   and delete items. The annual/permit renewal, the insurance renewal, the next check and the hours
--   to the next check stay on the group: they are tied to the flight log and tech log.
-- * Every group gets four starter items: Life raft, Life vests, Fire extinguisher and First aid kit.
--   Existing groups get them now, with their current dates carried over (the first aid kit starts
--   without a date); new groups get them through a trigger, however the group is created.
-- * A group can hold at most 30 items. Items stay in the order they were added.
-- * The daily reminder job (queue_reminders) reads the items. Reminders already sent for the three
--   old items are re-pointed at the new rows, so nobody gets the same reminder twice.
-- * The three old columns are left in place, unused. They are dropped in a later migration once this
--   has run live for a while (so nothing can be lost).
--
-- Run this on the live database BEFORE pushing the matching code. Until the code is pushed, changes
-- to those three dates made in the old screen land in the old columns and are not seen here.

create table public.aircraft_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  due_date date,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index aircraft_items_group_idx on public.aircraft_items (group_id, position, created_at);

alter table public.aircraft_items enable row level security;

create policy "members can view their group's aircraft items"
  on public.aircraft_items for select
  using (public.is_group_member(group_id));

create policy "admins can add aircraft items to their group"
  on public.aircraft_items for insert
  with check (public.is_group_admin(group_id));

create policy "admins can change their group's aircraft items"
  on public.aircraft_items for update
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

create policy "admins can delete their group's aircraft items"
  on public.aircraft_items for delete
  using (public.is_group_admin(group_id));

-- At most 30 items per group; a new item goes to the end of the list.
create function public.aircraft_items_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_max integer;
begin
  select count(*), coalesce(max(position), 0) into v_count, v_max
  from public.aircraft_items where group_id = new.group_id;
  if v_count >= 30 then
    raise exception 'aircraft_items_limit: a group can have at most 30 items';
  end if;
  if new.position is null or new.position = 0 then
    new.position := v_max + 1;
  end if;
  new.label := btrim(new.label);
  return new;
end;
$$;

create trigger aircraft_items_before_insert
  before insert on public.aircraft_items
  for each row execute function public.aircraft_items_before_insert();

-- An item cannot be moved to another group, and its label is stored trimmed.
create function public.aircraft_items_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id <> old.group_id then
    raise exception 'an aircraft item cannot move to another group';
  end if;
  new.label := btrim(new.label);
  return new;
end;
$$;

create trigger aircraft_items_before_update
  before update on public.aircraft_items
  for each row execute function public.aircraft_items_before_update();

-- ------------------------------------------------- existing groups: carry the dates over
insert into public.aircraft_items (group_id, label, due_date, position)
select g.id, v.label, v.due, v.pos
from public.groups g
cross join lateral (values
  ('Life raft', g.life_raft_due, 1),
  ('Life vests', g.life_vests_due, 2),
  ('Fire extinguisher', g.fire_extinguisher_due, 3),
  ('First aid kit', null::date, 4)
) as v(label, due, pos);

-- Reminders already sent for the three old items now belong to the new rows (the key holds the item).
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('life_raft', 'Life raft'),
      ('life_vests', 'Life vests'),
      ('fire_extinguisher', 'Fire extinguisher')
    ) as v(code, label)
  loop
    update public.reminder_log rl
    set key = 'aircraft:' || ai.id::text || substr(rl.key, length('aircraft:' || c.code) + 1)
    from public.aircraft_items ai
    where ai.group_id = rl.group_id
      and ai.label = c.label
      and rl.key like 'aircraft:' || c.code || ':%';
  end loop;
end;
$$;

-- ----------------------------------------------------- new groups get the four starter items
create function public.seed_aircraft_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.aircraft_items (group_id, label, position) values
    (new.id, 'Life raft', 1),
    (new.id, 'Life vests', 2),
    (new.id, 'Fire extinguisher', 3),
    (new.id, 'First aid kit', 4);
  return new;
end;
$$;

revoke all on function public.seed_aircraft_items() from public, anon, authenticated;

create trigger groups_seed_aircraft_items
  after insert on public.groups
  for each row execute function public.seed_aircraft_items();

-- ------------------------------------------------------------ reminders read the items
-- Same function as before (0014), except that the equipment dates now come from aircraft_items.

create or replace function public.queue_reminders(
  p_token text,
  p_group_id uuid default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/London')::date;
  v_tomorrow date := ((p_now at time zone 'Europe/London')::date) + 1;
  v_booking_emails integer := 0;
  v_aircraft_emails integer := 0;
  b record;
  g record;
  m record;
  it record;
  v_items jsonb;
  v_days integer;
  v_stage text;
  v_hours numeric;
begin
  if not public.notification_worker_ok(p_token) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  -- Booking reminders are only remembered for a month (by the real clock:
  -- p_now only decides what is due, never what counts as old).
  delete from public.reminder_log where key like 'booking:%' and created_at < now() - interval '30 days';

  -- Bookings that start tomorrow (UK date). Not ones made in the last three
  -- hours: a reminder straight after booking is just noise.
  for b in
    select bk.id, bk.group_id, bk.member_id, bk.starts_at, bk.ends_at, bk.note
    from public.bookings bk
    where bk.status = 'confirmed'
      and (p_group_id is null or bk.group_id = p_group_id)
      and (bk.starts_at at time zone 'Europe/London')::date = v_tomorrow
      and bk.created_at < p_now - interval '3 hours'
    order by bk.starts_at
  loop
    insert into public.reminder_log (group_id, key)
    values (b.group_id, 'booking:' || b.id::text)
    on conflict do nothing;
    if not found then
      continue;
    end if;
    if public.enqueue_notification_for(
      b.group_id, b.member_id, 'booking_reminder',
      jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'note', b.note)
    ) then
      v_booking_emails := v_booking_emails + 1;
    end if;
  end loop;

  -- Aircraft: every due date and the hours to the next check, per group.
  for g in
    select gr.* from public.groups gr
    where p_group_id is null or gr.id = p_group_id
    order by gr.created_at
  loop
    v_items := '[]'::jsonb;

    for it in
      select t.label, t.code, t.due
      from (
        select 1 as ord, 0 as pos, 'Annual/permit renewal' as label, 'annual' as code, g.annual_renewal_due as due
        union all
        select 1, 1, 'Insurance renewal', 'insurance', g.insurance_renewal_due
        union all
        select 1, 2, 'Next check', 'next_check', g.next_check_due
        union all
        select 2, ai.position, ai.label, ai.id::text, ai.due_date
        from public.aircraft_items ai
        where ai.group_id = g.id
      ) as t
      where t.due is not null
      order by t.ord, t.pos
    loop
      v_days := it.due - v_today;
      v_stage := case
        when v_days < 0 then 'overdue'
        when v_days <= 7 then '7'
        when v_days <= 30 then '30'
        else null
      end;
      if v_stage is null then
        continue;
      end if;

      insert into public.reminder_log (group_id, key)
      values (g.id, 'aircraft:' || it.code || ':' || it.due::text || ':' || v_stage)
      on conflict do nothing;
      if found then
        v_items := v_items || jsonb_build_object(
          'item', it.label, 'kind', 'date', 'due', it.due, 'days', v_days, 'stage', v_stage
        );
      end if;
    end loop;

    v_hours := g.hours_to_next_check;
    if v_hours is not null then
      v_stage := case
        when v_hours <= 0 then 'overdue'
        when v_hours <= 5 then '5'
        when v_hours <= 10 then '10'
        else null
      end;
      if v_stage is not null then
        insert into public.reminder_log (group_id, key)
        values (g.id, 'aircraft:hours:' || coalesce(g.next_check_at_hours::text, 'manual') || ':' || v_stage)
        on conflict do nothing;
        if found then
          v_items := v_items || jsonb_build_object(
            'item', 'Hours to next check', 'kind', 'hours',
            'hours', v_hours, 'limit', g.next_check_at_hours, 'stage', v_stage
          );
        end if;
      end if;
    end if;

    if jsonb_array_length(v_items) > 0 then
      for m in
        select gm.user_id from public.group_members gm
        where gm.group_id = g.id and gm.removed_at is null
      loop
        if public.enqueue_notification_for(
          g.id, m.user_id, 'aircraft_reminder',
          jsonb_build_object('items', v_items, 'registration', g.aircraft_registration)
        ) then
          v_aircraft_emails := v_aircraft_emails + 1;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'result', 'ok',
    'booking_reminders', v_booking_emails,
    'aircraft_reminders', v_aircraft_emails
  );
end;
$$;

revoke all on function public.queue_reminders(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.queue_reminders(text, uuid, timestamptz) to anon, authenticated;
