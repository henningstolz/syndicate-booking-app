-- Emailed statements: closing a month can email every member their statement.
--
-- * A new email a member can choose, `statement_ready` ("Monthly statements",
--   on until they switch it off), like the others in Settings, Notifications.
-- * close_cost_month() gains an optional last argument, p_notify (default true).
--   When it is true, one email per current member who wants it is queued, and
--   each carries ONLY that member's own part of the saved statement (their line,
--   their flights, their expenses, the rates, who closed the month and when), so
--   the server can print their PDF and attach it. Nobody else's figures go into
--   someone's email. Closing again after a reopen says "updated".
--   The answer now also says how many emails were queued.
-- * The "member's own part" is one small helper, used by cost_statement() and by
--   the queued emails alike.
--
-- Backwards compatible: the page that is live calls close_cost_month() with three
-- named arguments, which still works (the new one defaults to true). Run this
-- BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- The new email
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  drop constraint notification_preferences_event_check;

alter table public.notification_preferences
  add constraint notification_preferences_event_check check (event in (
    'booking_created', 'booking_cancelled', 'chat_message', 'flight_logged',
    'defect_reported', 'booking_reminder', 'aircraft_reminder', 'statement_ready'
  ));

create or replace function public.notification_default(p_event text)
returns boolean
language sql
immutable
as $$
  select p_event in (
    'booking_created', 'booking_cancelled', 'chat_message', 'defect_reported',
    'booking_reminder', 'aircraft_reminder', 'statement_ready'
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
    'defect_reported', 'booking_reminder', 'aircraft_reminder', 'statement_ready'
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
-- One member's own part of a saved statement
-- ---------------------------------------------------------------------------

create function public.cost_statement_member_view(p_snapshot jsonb, p_user_id uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_snapshot || jsonb_build_object(
    'is_admin', false,
    'members', coalesce((select jsonb_agg(m) from jsonb_array_elements(p_snapshot->'members') m where m->>'user_id' = p_user_id::text), '[]'::jsonb),
    'flights', coalesce((select jsonb_agg(f) from jsonb_array_elements(p_snapshot->'flights') f where f->>'user_id' = p_user_id::text), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(e) from jsonb_array_elements(p_snapshot->'expenses') e where e->>'user_id' = p_user_id::text), '[]'::jsonb)
  );
$$;

revoke all on function public.cost_statement_member_view(jsonb, uuid) from public, anon, authenticated;

-- cost_statement() as in 0018, with the member's part taken from the helper.
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
  v_live jsonb;
  v_admin boolean;
  v_over boolean;
  v_closure public.cost_month_closures%rowtype;
  v_closed jsonb;
  v_drift jsonb;
begin
  v_live := public.cost_statement_live(p_group_id, p_month);
  if v_live->>'result' <> 'ok' then
    return v_live;
  end if;
  v_admin := (v_live->>'is_admin')::boolean;
  v_over := v_start < date_trunc('month', now() at time zone 'Europe/London')::date;

  select * into v_closure
  from public.cost_month_closures c
  where c.group_id = p_group_id and c.month = v_start and c.reopened_at is null;

  if not found then
    return v_live || jsonb_build_object(
      'closed', null,
      'can_close', v_admin and v_over and not (v_live->'rates'->>'missing')::boolean,
      'drift', '[]'::jsonb
    );
  end if;

  v_closed := jsonb_build_object(
    'id', v_closure.id,
    'closed_at', v_closure.closed_at,
    'closed_by_name', coalesce((
      select m.display_name from public.group_members m
      where m.group_id = p_group_id and m.user_id = v_closure.closed_by
    ), 'An admin'),
    'note', v_closure.note
  );

  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', coalesce(c.uid, n.uid),
        'name', coalesce(c.name, n.name),
        'closed_pence', coalesce(c.total, 0),
        'now_pence', coalesce(n.total, 0),
        'closed_tenths', coalesce(c.tenths, 0),
        'now_tenths', coalesce(n.tenths, 0)
      ) order by coalesce(c.name, n.name), coalesce(c.uid, n.uid)), '[]'::jsonb)
    into v_drift
    from (
      select m->>'user_id' as uid, m->>'name' as name,
             (m->>'total_pence')::integer as total, (m->>'hours_tenths')::integer as tenths
      from jsonb_array_elements(v_closure.snapshot->'members') m
    ) c
    full join (
      select m->>'user_id' as uid, m->>'name' as name,
             (m->>'total_pence')::integer as total, (m->>'hours_tenths')::integer as tenths
      from jsonb_array_elements(v_live->'members') m
    ) n on n.uid = c.uid
    where coalesce(c.total, 0) <> coalesce(n.total, 0)
       or coalesce(c.tenths, 0) <> coalesce(n.tenths, 0);

    return v_closure.snapshot || jsonb_build_object(
      'is_admin', true, 'closed', v_closed, 'can_close', false, 'drift', v_drift
    );
  end if;

  -- A member gets only their own part of the saved figures.
  return public.cost_statement_member_view(v_closure.snapshot, v_me) || jsonb_build_object(
    'closed', v_closed,
    'can_close', false,
    'drift', '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Closing a month, optionally emailing everyone their statement
-- ---------------------------------------------------------------------------

drop function public.close_cost_month(uuid, date, text);

create function public.close_cost_month(
  p_group_id uuid,
  p_month date,
  p_note text default null,
  p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_live jsonb;
  v_id uuid;
  v_closed_at timestamptz;
  v_updated boolean;
  v_closed jsonb;
  v_registration text;
  v_queued integer := 0;
  m record;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;
  -- Only a finished month (UK time) can be closed.
  if v_start >= date_trunc('month', now() at time zone 'Europe/London')::date then
    return jsonb_build_object('result', 'month_not_over');
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('result', 'note_too_long');
  end if;
  if public.cost_month_closed(p_group_id, v_start) then
    return jsonb_build_object('result', 'already_closed');
  end if;

  v_live := public.cost_statement_live(p_group_id, v_start);
  if v_live->>'result' <> 'ok' then
    return v_live;
  end if;
  -- Freezing a month with no rates would freeze zeros.
  if (v_live->'rates'->>'missing')::boolean then
    return jsonb_build_object('result', 'rates_missing');
  end if;

  -- Closed before and reopened since? Then the emails say "updated".
  v_updated := exists (
    select 1 from public.cost_month_closures c
    where c.group_id = p_group_id and c.month = v_start and c.reopened_at is not null
  );

  insert into public.cost_month_closures (group_id, month, snapshot, note, closed_by)
  values (p_group_id, v_start, v_live, v_note, auth.uid())
  returning id, closed_at into v_id, v_closed_at;

  if coalesce(p_notify, false) then
    select g.aircraft_registration into v_registration from public.groups g where g.id = p_group_id;
    v_closed := jsonb_build_object(
      'id', v_id,
      'closed_at', v_closed_at,
      'closed_by_name', coalesce((
        select gm.display_name from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = auth.uid()
      ), 'An admin'),
      'note', v_note
    );
    -- One email per member of the month who is still in the group and wants it
    -- (enqueue_notification_for checks both), each with only their own figures.
    for m in
      select (e->>'user_id')::uuid as user_id
      from jsonb_array_elements(v_live->'members') e
      where (e->>'is_member')::boolean
    loop
      if public.enqueue_notification_for(
        p_group_id, m.user_id, 'statement_ready',
        public.cost_statement_member_view(v_live, m.user_id) || jsonb_build_object(
          'closed', v_closed,
          'can_close', false,
          'drift', '[]'::jsonb,
          'registration', v_registration,
          'updated', v_updated
        )
      ) then
        v_queued := v_queued + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('result', 'ok', 'emails_queued', v_queued);
end;
$$;

revoke all on function public.close_cost_month(uuid, date, text, boolean) from public, anon;
grant execute on function public.close_cost_month(uuid, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- A preview for the admin, to check the email and PDF before members get any
-- ---------------------------------------------------------------------------

-- Queues one statement email to the calling admin only (whatever their own email
-- settings say), for any month they have a statement in: the saved figures if the
-- month is closed, the figures so far if not. Marked as a preview; nobody else is
-- emailed.
create function public.preview_statement_email(p_group_id uuid, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_statement jsonb;
  v_email text;
  v_registration text;
  v_view jsonb;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_month is null or v_start < date '2000-01-01' or v_start > date '2100-01-01' then
    return jsonb_build_object('result', 'month_invalid');
  end if;

  v_statement := public.cost_statement(p_group_id, v_start);
  if v_statement->>'result' <> 'ok' then
    return v_statement;
  end if;
  v_view := public.cost_statement_member_view(v_statement, auth.uid());
  if jsonb_array_length(v_view->'members') = 0 then
    return jsonb_build_object('result', 'no_statement');
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null or v_email = '' then
    return jsonb_build_object('result', 'no_email');
  end if;
  select g.aircraft_registration into v_registration from public.groups g where g.id = p_group_id;

  insert into public.notification_outbox (group_id, recipient_user_id, recipient_email, event, payload)
  values (
    p_group_id, auth.uid(), v_email, 'statement_ready',
    v_view || jsonb_build_object(
      'can_close', false, 'drift', '[]'::jsonb,
      'registration', v_registration, 'updated', false, 'preview', true
    )
  );
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.preview_statement_email(uuid, date) from public, anon;
grant execute on function public.preview_statement_email(uuid, date) to authenticated;
