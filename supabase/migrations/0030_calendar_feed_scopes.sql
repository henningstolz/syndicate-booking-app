-- Calendar subscription, two kinds of private link per member and group (0021 made one):
--
-- * 'all'  : the whole group's confirmed bookings, the member's own marked "You" (as before).
-- * 'mine' : only the member's own confirmed bookings.
--
-- A member can have one active link of each kind at the same time. Making a new link, or turning one off,
-- affects only that kind. Every link that exists today becomes an 'all' link and keeps working unchanged.
--
-- * `calendar_feeds.scope` says which kind a link is (default 'all').
-- * `create_calendar_feed(group, scope)` and `revoke_calendar_feed(group, scope)` take the kind; left out, it
--   is 'all', so the code from before this migration keeps working.
-- * `calendar_feed(token)` (what the public feed address asks) returns only the member's own bookings for a
--   'mine' link, and says which kind the link is.
--
-- Additive: run it BEFORE pushing the matching code.

alter table public.calendar_feeds
  add column scope text not null default 'all' check (scope in ('all', 'mine'));

-- At most one active link per member, group and kind.
drop index public.calendar_feeds_one_active;
create unique index calendar_feeds_one_active
  on public.calendar_feeds (group_id, user_id, scope) where revoked_at is null;

-- Create (or replace) the caller's link of one kind for a group.
drop function public.create_calendar_feed(uuid);
create function public.create_calendar_feed(p_group_id uuid, p_scope text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_scope is null or p_scope not in ('all', 'mine') then
    return jsonb_build_object('result', 'scope_invalid');
  end if;

  update public.calendar_feeds
  set revoked_at = now()
  where group_id = p_group_id and user_id = auth.uid() and scope = p_scope and revoked_at is null;

  -- Two random UUIDs without dashes: 64 hex characters.
  insert into public.calendar_feeds (group_id, user_id, token, scope)
  values (p_group_id, auth.uid(), replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), p_scope);
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Turn the caller's link of one kind off.
drop function public.revoke_calendar_feed(uuid);
create function public.revoke_calendar_feed(p_group_id uuid, p_scope text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_scope is null or p_scope not in ('all', 'mine') then
    return jsonb_build_object('result', 'scope_invalid');
  end if;

  update public.calendar_feeds
  set revoked_at = now()
  where group_id = p_group_id and user_id = auth.uid() and scope = p_scope and revoked_at is null;
  if not found then
    return jsonb_build_object('result', 'no_feed');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.create_calendar_feed(uuid, text) from public, anon;
revoke all on function public.revoke_calendar_feed(uuid, text) from public, anon;
grant execute on function public.create_calendar_feed(uuid, text) to authenticated;
grant execute on function public.revoke_calendar_feed(uuid, text) to authenticated;

-- What the public feed address asks, as in 0021, now answering with only the member's own bookings for a
-- 'mine' link. Null for anything that is not an active link of a current member.
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
    ), '[]'::jsonb)
  );
end;
$$;
