-- Email notifications.
--
-- * `notification_preferences`: which events a member wants emailed, per group
--   (only explicit choices are stored; anything not chosen follows the defaults
--   in notification_default()).
-- * `notification_outbox`: the queue. When a booking is made or cancelled, a
--   chat message is posted, or a flight is logged, a trigger queues one row per
--   member who should hear about it (never the person who did it, never a
--   removed member). The app's server then sends the queued emails through
--   Resend and marks them sent; anything that fails stays queued and is retried.
-- * `notification_worker`: holds the HASH of a long random secret. The server
--   proves it knows the secret to claim queued emails. That secret can only
--   read and mark the queue; it is not a database master key.
--
-- A problem queuing a notification must never block a booking, a post or a
-- flight, so every trigger swallows its own errors (with a warning).
--
-- Backwards compatible: run this BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.notification_preferences (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null check (event in (
    'booking_created', 'booking_cancelled', 'chat_message', 'flight_logged', 'defect_reported'
  )),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id, event)
);

alter table public.notification_preferences enable row level security;

-- A member can read their own choices. Writing goes through
-- set_notification_preferences() only.
create policy "members can read their own notification preferences"
  on public.notification_preferences for select
  to authenticated
  using (user_id = auth.uid());

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_email text not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text
);

create index notification_outbox_pending_idx
  on public.notification_outbox (created_at) where sent_at is null;
create index notification_outbox_recipient_idx
  on public.notification_outbox (recipient_user_id, created_at);

-- Nobody reads the queue through the API: RLS on, no policies, no privileges.
alter table public.notification_outbox enable row level security;
revoke all on table public.notification_outbox from anon, authenticated;

create table public.notification_worker (
  token_hash text primary key,
  created_at timestamptz not null default now()
);

alter table public.notification_worker enable row level security;
revoke all on table public.notification_worker from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Defaults and who wants what
-- ---------------------------------------------------------------------------

-- What is on when a member has not chosen: everything that affects other
-- people's plans or safety. Routine "a flight was logged" is off.
create function public.notification_default(p_event text)
returns boolean
language sql
immutable
as $$
  select p_event in ('booking_created', 'booking_cancelled', 'chat_message', 'defect_reported');
$$;

create function public.notification_enabled(p_group_id uuid, p_user_id uuid, p_event text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select enabled from public.notification_preferences
     where group_id = p_group_id and user_id = p_user_id and event = p_event),
    public.notification_default(p_event)
  );
$$;

create function public.notification_member_name(p_group_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select display_name from public.group_members
     where group_id = p_group_id and user_id = p_user_id),
    'A member'
  );
$$;

revoke all on function public.notification_enabled(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.notification_member_name(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queuing
-- ---------------------------------------------------------------------------

-- Queue one email per current member who wants this event, except the person
-- who caused it (and anyone in p_exclude). At most 20 emails per person per
-- hour: a flood of chat messages cannot flood someone's inbox. Returns who was
-- queued.
create function public.enqueue_notification(
  p_group_id uuid,
  p_event text,
  p_actor uuid,
  p_payload jsonb,
  p_exclude uuid[] default '{}'
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued uuid[] := '{}';
  r record;
begin
  for r in
    select m.user_id, u.email
    from public.group_members m
    join auth.users u on u.id = m.user_id
    where m.group_id = p_group_id
      and m.removed_at is null
      and u.email is not null
      and u.email <> ''
      and m.user_id is distinct from p_actor
      and not (m.user_id = any (p_exclude))
      and public.notification_enabled(p_group_id, m.user_id, p_event)
  loop
    if (
      select count(*) from public.notification_outbox o
      where o.recipient_user_id = r.user_id
        and o.created_at > now() - interval '1 hour'
    ) >= 20 then
      continue;
    end if;

    insert into public.notification_outbox (group_id, recipient_user_id, recipient_email, event, payload)
    values (p_group_id, r.user_id, r.email, p_event, p_payload);
    v_queued := v_queued || r.user_id;
  end loop;
  return v_queued;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, uuid, jsonb, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.notify_booking_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' then
    begin
      perform public.enqueue_notification(
        new.group_id, 'booking_created', new.member_id,
        jsonb_build_object(
          'who', public.notification_member_name(new.group_id, new.member_id),
          'starts_at', new.starts_at,
          'ends_at', new.ends_at,
          'note', new.note
        )
      );
    exception when others then
      raise warning 'notification not queued: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;

create trigger bookings_notify_created
  after insert on public.bookings
  for each row execute function public.notify_booking_created();

create function public.notify_booking_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed'
     and new.status = 'cancelled'
     and coalesce(current_setting('blocktime.suppress_notifications', true), '') <> 'on' then
    begin
      perform public.enqueue_notification(
        new.group_id, 'booking_cancelled', new.cancelled_by,
        jsonb_build_object(
          'who', public.notification_member_name(new.group_id, new.member_id),
          'cancelled_by', case
            when new.cancelled_by is distinct from new.member_id
              then public.notification_member_name(new.group_id, new.cancelled_by)
            else null
          end,
          'starts_at', new.starts_at,
          'ends_at', new.ends_at,
          'note', new.note
        )
      );
    exception when others then
      raise warning 'notification not queued: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;

create trigger bookings_notify_cancelled
  after update of status on public.bookings
  for each row execute function public.notify_booking_cancelled();

create function public.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.enqueue_notification(
      new.group_id, 'chat_message', new.author_id,
      jsonb_build_object(
        'who', public.notification_member_name(new.group_id, new.author_id),
        'message', left(new.message, 500)
      )
    );
  exception when others then
    raise warning 'notification not queued: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger squawks_notify_chat
  after insert on public.squawks
  for each row execute function public.notify_chat_message();

-- A flight with a defect tells those who want defects (instead of, not on top
-- of, the routine "flight logged" email); everyone else who wants flights
-- logged gets that one.
create function public.notify_flight_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_defect_recipients uuid[] := '{}';
begin
  begin
    v_payload := jsonb_build_object(
      'captain', new.captain_name,
      'logged_by', case
        when new.created_by is distinct from new.captain_id
          then public.notification_member_name(new.group_id, new.created_by)
        else null
      end,
      'from', new.from_place,
      'to', new.to_place,
      'category', new.flight_category,
      'brakes_off', new.brakes_off,
      'flight_minutes', new.flight_minutes,
      'flight_deci', new.flight_deci,
      'defects', new.defects
    );
    if new.defects is not null then
      v_defect_recipients := public.enqueue_notification(
        new.group_id, 'defect_reported', new.created_by, v_payload
      );
    end if;
    perform public.enqueue_notification(
      new.group_id, 'flight_logged', new.created_by, v_payload, v_defect_recipients
    );
  exception when others then
    raise warning 'notification not queued: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger flight_entries_notify_logged
  after insert on public.flight_entries
  for each row execute function public.notify_flight_logged();

revoke all on function public.notify_booking_created() from public, anon, authenticated;
revoke all on function public.notify_booking_cancelled() from public, anon, authenticated;
revoke all on function public.notify_chat_message() from public, anon, authenticated;
revoke all on function public.notify_flight_logged() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Removing a member or leaving cancels their upcoming bookings: that should
-- not send an email per booking. (Same functions as in 0010, plus one line.)
-- ---------------------------------------------------------------------------

create or replace function public.remove_member(p_group_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.group_members%rowtype;
  v_other_admins integer;
  v_cancelled integer;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_user_id = auth.uid() then
    -- Leaving yourself is its own action: see leave_group.
    return jsonb_build_object('result', 'use_leave');
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  select * into v_target
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id and removed_at is null;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- The caller is an admin other than the target, so the group keeps at
  -- least one admin whoever is removed.
  select count(*) into v_other_admins
  from public.group_members
  where group_id = p_group_id
    and role = 'admin'
    and removed_at is null
    and user_id <> p_user_id;
  if v_target.role = 'admin' and v_other_admins = 0 then
    return jsonb_build_object('result', 'last_admin');
  end if;

  update public.group_members set removed_at = now() where id = v_target.id;

  -- Cancelling their upcoming bookings must not email the whole group once
  -- per booking.
  perform set_config('blocktime.suppress_notifications', 'on', true);

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where group_id = p_group_id
    and member_id = p_user_id
    and status = 'confirmed'
    and starts_at > now();
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('result', 'ok', 'cancelled_bookings', v_cancelled);
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_me public.group_members%rowtype;
  v_other_admins integer;
  v_cancelled integer;
begin
  if v_user is null then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  select * into v_me
  from public.group_members
  where group_id = p_group_id and user_id = v_user and removed_at is null;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if v_me.role = 'admin' then
    select count(*) into v_other_admins
    from public.group_members
    where group_id = p_group_id
      and role = 'admin'
      and removed_at is null
      and user_id <> v_user;
    if v_other_admins = 0 then
      return jsonb_build_object('result', 'last_admin');
    end if;
  end if;

  update public.group_members set removed_at = now() where id = v_me.id;

  -- Cancelling their upcoming bookings must not email the whole group once
  -- per booking.
  perform set_config('blocktime.suppress_notifications', 'on', true);

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user
  where group_id = p_group_id
    and member_id = v_user
    and status = 'confirmed'
    and starts_at > now();
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('result', 'ok', 'cancelled_bookings', v_cancelled);
end;
$$;

-- ---------------------------------------------------------------------------
-- A member's own choices
-- ---------------------------------------------------------------------------

-- Save a member's choices for a group, e.g. {"chat_message": false, ...}.
create function public.set_notification_preferences(p_group_id uuid, p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_known text[] := array['booking_created', 'booking_cancelled', 'chat_message', 'flight_logged', 'defect_reported'];
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

revoke all on function public.set_notification_preferences(uuid, jsonb) from public, anon;
grant execute on function public.set_notification_preferences(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The sender's side: claim queued emails, report how it went
-- ---------------------------------------------------------------------------

create function public.notification_worker_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_token is not null
    and char_length(p_token) >= 24
    and exists (
      select 1 from public.notification_worker
      where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    );
$$;

revoke all on function public.notification_worker_ok(text) from public, anon, authenticated;

-- Hand out up to p_limit emails to send, and count the attempt. Anything
-- already tried in the last two minutes, tried five times, or older than a day
-- is left alone (an email about a booking from last week is not useful).
-- Without the right secret this returns nothing.
create function public.claim_notifications(p_token text, p_limit integer default 20)
returns table (
  id uuid,
  recipient_email text,
  event text,
  payload jsonb,
  group_name text,
  group_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.notification_worker_ok(p_token) then
    return;
  end if;

  delete from public.notification_outbox o
  where (o.sent_at is not null and o.sent_at < now() - interval '30 days')
     or (o.sent_at is null and o.created_at < now() - interval '7 days');

  return query
  with picked as (
    select o.id
    from public.notification_outbox o
    where o.sent_at is null
      and o.attempts < 5
      and o.created_at > now() - interval '24 hours'
      and (o.last_attempt_at is null or o.last_attempt_at < now() - interval '2 minutes')
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 50))
    for update skip locked
  ), claimed as (
    update public.notification_outbox o
    set attempts = o.attempts + 1, last_attempt_at = now()
    from picked
    where o.id = picked.id
    returning o.id, o.group_id, o.recipient_email, o.event, o.payload
  )
  select c.id, c.recipient_email, c.event, c.payload, g.name, g.slug
  from claimed c
  join public.groups g on g.id = c.group_id
  order by c.id;
end;
$$;

create function public.mark_notification_sent(p_token text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.notification_worker_ok(p_token) then
    return false;
  end if;
  update public.notification_outbox
  set sent_at = now(), last_error = null
  where id = p_id and sent_at is null;
  return found;
end;
$$;

create function public.mark_notification_failed(p_token text, p_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.notification_worker_ok(p_token) then
    return false;
  end if;
  update public.notification_outbox
  set last_error = left(coalesce(p_error, 'unknown'), 300)
  where id = p_id and sent_at is null;
  return found;
end;
$$;

-- The server calls these with the anonymous key plus its secret.
revoke all on function public.claim_notifications(text, integer) from public, anon, authenticated;
revoke all on function public.mark_notification_sent(text, uuid) from public, anon, authenticated;
revoke all on function public.mark_notification_failed(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(text, integer) to anon, authenticated;
grant execute on function public.mark_notification_sent(text, uuid) to anon, authenticated;
grant execute on function public.mark_notification_failed(text, uuid, text) to anon, authenticated;
