-- Group and user management.
--
-- 1. A member can be REMOVED without deleting their row, so bookings and
--    tech log entries keep their name and colour. A removed member is neither
--    a member nor an admin as far as the access rules are concerned, and can
--    be invited again.
-- 2. Roles can be changed, members can be removed, and anyone can leave. All
--    three go through SECURITY DEFINER functions that refuse to leave a group
--    without an admin. (Writes live in functions, not table policies: a policy
--    cannot restrict which COLUMNS change, so a plain UPDATE policy would let
--    a member promote themselves.)
-- 3. Invites get a name label, a 14-day expiry and can be revoked.
-- 4. Accepting an invite is one atomic function instead of two client calls.
--
-- Backwards compatible: code from before this migration keeps working, so run
-- this BEFORE pushing the matching code.

-- ---------------------------------------------------------------------------
-- 1. Soft removal
-- ---------------------------------------------------------------------------

alter table public.group_members
  add column removed_at timestamptz;

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and removed_at is null
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and role = 'admin'
      and removed_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Invites: label, expiry, revoking
-- ---------------------------------------------------------------------------

alter table public.invites
  add column label text check (char_length(label) <= 60),
  add column expires_at timestamptz not null default (now() + interval '14 days'),
  add column revoked_at timestamptz;

create or replace function public.has_valid_invite(p_group_id uuid, p_role text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.invites i
    where i.group_id = p_group_id
      and i.role = p_role
      and i.used_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  );
$$;

-- The return type gains two columns, which CREATE OR REPLACE cannot do.
drop function public.get_invite_info(uuid);

create function public.get_invite_info(invite_id uuid)
returns table (
  group_id uuid,
  group_slug text,
  group_name text,
  role text,
  is_valid boolean,
  label text,
  status text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    g.id,
    g.slug,
    g.name,
    i.role,
    (i.used_at is null and i.revoked_at is null and i.expires_at > now()),
    i.label,
    case
      when i.used_at is not null then 'used'
      when i.revoked_at is not null then 'revoked'
      when i.expires_at <= now() then 'expired'
      else 'valid'
    end
  from public.invites i
  join public.groups g on g.id = i.group_id
  where i.id = invite_id;
$$;

grant execute on function public.get_invite_info(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Functions that change membership
--
-- Every function returns jsonb like {"result": "ok"} or {"result": "last_admin"}
-- so the app can show a plain message instead of a database error.
-- ---------------------------------------------------------------------------

-- Join (or rejoin) a group through an invite, in one step.
create function public.accept_invite(p_invite_id uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_invite public.invites%rowtype;
  v_member public.group_members%rowtype;
  v_slug text;
begin
  if v_user is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if v_name = '' then
    return jsonb_build_object('result', 'name_required');
  end if;
  if char_length(v_name) > 60 then
    return jsonb_build_object('result', 'name_too_long');
  end if;

  select * into v_invite from public.invites where id = p_invite_id for update;
  if not found then
    return jsonb_build_object('result', 'invalid');
  end if;

  if v_invite.used_at is not null then
    return jsonb_build_object('result', 'used');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('result', 'revoked');
  end if;
  if v_invite.expires_at <= now() then
    return jsonb_build_object('result', 'expired');
  end if;

  select slug into v_slug from public.groups where id = v_invite.group_id;

  select * into v_member
  from public.group_members
  where group_id = v_invite.group_id and user_id = v_user
  for update;

  if found then
    if v_member.removed_at is null then
      -- Already in: leave the invite unused for someone else.
      return jsonb_build_object('result', 'already_member', 'group_slug', v_slug);
    end if;
    -- Coming back after being removed.
    update public.group_members
    set removed_at = null, role = v_invite.role, display_name = v_name
    where id = v_member.id;
  else
    insert into public.group_members (group_id, user_id, role, display_name)
    values (v_invite.group_id, v_user, v_invite.role, v_name);
  end if;

  update public.invites
  set used_by = v_user, used_at = now()
  where id = p_invite_id;

  return jsonb_build_object('result', 'ok', 'group_slug', v_slug);
end;
$$;

-- Cancel an invite that has not been used yet.
create function public.revoke_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites%rowtype;
begin
  select * into v_invite from public.invites where id = p_invite_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_group_admin(v_invite.group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if v_invite.used_at is not null then
    return jsonb_build_object('result', 'already_used');
  end if;

  update public.invites set revoked_at = now()
  where id = p_invite_id and revoked_at is null;

  return jsonb_build_object('result', 'ok');
end;
$$;

-- Promote a member to admin, or demote an admin to member.
create function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.group_members%rowtype;
  v_other_admins integer;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if p_role not in ('admin', 'member') then
    return jsonb_build_object('result', 'invalid_role');
  end if;

  -- Serialise membership changes within a group, so two admins demoting each
  -- other at the same moment cannot both pass the "last admin" check.
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

  if v_target.role = 'admin' and p_role = 'member' then
    select count(*) into v_other_admins
    from public.group_members
    where group_id = p_group_id
      and role = 'admin'
      and removed_at is null
      and user_id <> p_user_id;
    if v_other_admins = 0 then
      return jsonb_build_object('result', 'last_admin');
    end if;
  end if;

  update public.group_members set role = p_role where id = v_target.id;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Remove a member (admin action). Their future bookings are cancelled so they
-- do not block the aircraft; past bookings and posts are untouched.
create function public.remove_member(p_group_id uuid, p_user_id uuid)
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

-- Leave a group yourself.
create function public.leave_group(p_group_id uuid)
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

-- Change your own display name in a group.
create function public.set_my_display_name(p_group_id uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if auth.uid() is null then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if v_name = '' then
    return jsonb_build_object('result', 'name_required');
  end if;
  if char_length(v_name) > 60 then
    return jsonb_build_object('result', 'name_too_long');
  end if;

  update public.group_members
  set display_name = v_name
  where group_id = p_group_id
    and user_id = auth.uid()
    and removed_at is null;

  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- Only signed-in users may call these.
revoke all on function public.accept_invite(uuid, text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
revoke all on function public.set_my_display_name(uuid, text) from public, anon;

grant execute on function public.accept_invite(uuid, text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.set_my_display_name(uuid, text) to authenticated;
