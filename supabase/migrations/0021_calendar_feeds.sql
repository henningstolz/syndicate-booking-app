-- Calendar subscription (iCal): a private link per member and group that shows the
-- group's bookings in Apple Calendar, Google Calendar or Outlook.
--
-- Calendar apps cannot sign in, so the link itself carries a long random secret
-- (64 hex characters, about 240 bits). Anyone who has the link can see what the feed
-- shows, so a member can turn it off or replace it at any time, which stops the old
-- link at once. A removed member's link stops working too.
--
-- * `calendar_feeds`: one active link per member and group (a new one revokes the
--   old). A member reads only their own row (that is how they see their link);
--   nobody writes the table directly.
-- * `calendar_feed(token)`: the one thing the public feed address calls. It answers
--   only for an active link of a current member, and returns that group's confirmed
--   bookings from 60 days ago onwards, marking the member's own. Cancelled bookings
--   are left out, so they vanish from the calendar at its next refresh.
--
-- Backwards compatible: nothing live uses it yet. Run this BEFORE pushing the
-- matching code.

create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique check (char_length(token) = 64),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- At most one active link per member and group.
create unique index calendar_feeds_one_active
  on public.calendar_feeds (group_id, user_id) where revoked_at is null;

alter table public.calendar_feeds enable row level security;

create policy "members can view their own calendar links"
  on public.calendar_feeds for select
  using (user_id = auth.uid() and public.is_group_member(group_id));

-- Create (or replace) the caller's link for a group.
create function public.create_calendar_feed(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.calendar_feeds
  set revoked_at = now()
  where group_id = p_group_id and user_id = auth.uid() and revoked_at is null;

  -- Two random UUIDs without dashes: 64 hex characters.
  insert into public.calendar_feeds (group_id, user_id, token)
  values (p_group_id, auth.uid(), replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Turn the caller's link off.
create function public.revoke_calendar_feed(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.calendar_feeds
  set revoked_at = now()
  where group_id = p_group_id and user_id = auth.uid() and revoked_at is null;
  if not found then
    return jsonb_build_object('result', 'no_feed');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- What the public feed address asks. Null for anything that is not an active link
-- of a current member.
create function public.calendar_feed(p_token text)
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_calendar_feed(uuid) from public, anon;
revoke all on function public.revoke_calendar_feed(uuid) from public, anon;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.create_calendar_feed(uuid) to authenticated;
grant execute on function public.revoke_calendar_feed(uuid) to authenticated;
-- The public feed address calls this with no login, using only the secret.
grant execute on function public.calendar_feed(text) to anon, authenticated;
