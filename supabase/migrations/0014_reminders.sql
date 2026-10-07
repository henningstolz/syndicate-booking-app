-- Reminders: emails sent by a timer rather than by an action.
--
-- * booking_reminder: the evening before a booking, to the person who made it.
-- * aircraft_reminder: when a due date (next check, insurance, annual, life
--   raft, life vests, fire extinguisher) is 30 days, 7 days or past, and when
--   the hours to the next check reach 10, 5 or the limit. Several items that
--   fall due on the same day go into one email per member.
--
-- Each reminder is sent ONCE: `reminder_log` remembers what has been sent. For
-- aircraft items the memory includes the due date (or the hours limit), so a
-- renewal or a completed check starts the countdown afresh.
--
-- queue_reminders() is called once a day by the server with the sender's
-- secret (the same one as claim_notifications). It only queues emails; the
-- normal sending loop delivers them.
--
-- Backwards compatible: run this BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- Two more events a member can choose
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  drop constraint notification_preferences_event_check;

alter table public.notification_preferences
  add constraint notification_preferences_event_check check (event in (
    'booking_created', 'booking_cancelled', 'chat_message', 'flight_logged',
    'defect_reported', 'booking_reminder', 'aircraft_reminder'
  ));

create or replace function public.notification_default(p_event text)
returns boolean
language sql
immutable
as $$
  select p_event in (
    'booking_created', 'booking_cancelled', 'chat_message', 'defect_reported',
    'booking_reminder', 'aircraft_reminder'
  );
$$;

create or replace function public.set_notification_preferences(p_group_id uuid, p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_known text[] := array[
    'booking_created', 'booking_cancelled', 'chat_message', 'flight_logged',
    'defect_reported', 'booking_reminder', 'aircraft_reminder'
  ];
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    return jsonb_build_object('result', 'invalid');
  end if;

  for v_key, v_value in select * from jsonb_each(p_prefs) loop
    if not (v_key = any (v_known)) or jsonb_typeof(v_value) <> 'boolean' then
      return jsonb_build_object('result', 'invalid');
    end if;
  end loop;

  for v_key, v_value in select * from jsonb_each(p_prefs) loop
    insert into public.notification_preferences (group_id, user_id, event, enabled)
    values (p_group_id, auth.uid(), v_key, (v_value #>> '{}')::boolean)
    on conflict (group_id, user_id, event)
    do update set enabled = excluded.enabled, updated_at = now();
  end loop;

  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- What has already been sent
-- ---------------------------------------------------------------------------

create table public.reminder_log (
  group_id uuid not null references public.groups (id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, key)
);

alter table public.reminder_log enable row level security;
revoke all on table public.reminder_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queue one email for one named member (same checks as the event emails: a
-- current member, with an address, who wants this event, within the hourly cap)
-- ---------------------------------------------------------------------------

create function public.enqueue_notification_for(
  p_group_id uuid,
  p_user_id uuid,
  p_event text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select u.email into v_email
  from public.group_members m
  join auth.users u on u.id = m.user_id
  where m.group_id = p_group_id
    and m.user_id = p_user_id
    and m.removed_at is null
    and u.email is not null
    and u.email <> '';
  if v_email is null then
    return false;
  end if;
  if not public.notification_enabled(p_group_id, p_user_id, p_event) then
    return false;
  end if;
  if (
    select count(*) from public.notification_outbox o
    where o.recipient_user_id = p_user_id
      and o.created_at > now() - interval '1 hour'
  ) >= 20 then
    return false;
  end if;

  insert into public.notification_outbox (group_id, recipient_user_id, recipient_email, event, payload)
  values (p_group_id, p_user_id, v_email, p_event, p_payload);
  return true;
end;
$$;

revoke all on function public.enqueue_notification_for(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The daily job's work: queue whatever reminders are due
-- ---------------------------------------------------------------------------

-- p_group_id limits it to one group (the admin's "send reminders now" button);
-- p_now is only there so the tests can pretend it is another time. "Tomorrow"
-- and "today" are UK days, so the clocks changing cannot move a reminder.
create function public.queue_reminders(
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
      select * from (values
        ('Annual/permit renewal', 'annual', g.annual_renewal_due),
        ('Insurance renewal', 'insurance', g.insurance_renewal_due),
        ('Next check', 'next_check', g.next_check_due),
        ('Life raft', 'life_raft', g.life_raft_due),
        ('Life vests', 'life_vests', g.life_vests_due),
        ('Fire extinguisher', 'fire_extinguisher', g.fire_extinguisher_due)
      ) as t(label, code, due)
      where t.due is not null
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
