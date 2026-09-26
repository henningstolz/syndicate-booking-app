-- Two RLS policies from migration 0006 had raw subqueries on a table
-- protected by its own RLS, which is subject to that same RLS from
-- inside the check — exactly the recursion problem is_group_member()/
-- is_group_admin() already exist to avoid, just missed here.
--
-- 1. "join via invite": checked `exists (select ... from invites)`,
--    but invites' own SELECT policy is admin-only — so a joining
--    non-member could never see the invite row, and the check always
--    failed (this is the "invite may have just been used" bug).
-- 2. "claim a brand-new empty group": checked
--    `not exists (select ... from group_members)`, but group_members'
--    own SELECT policy only shows rows to existing members of that
--    group — so to a user with NO memberships anywhere, every group
--    looks empty, including established ones. That made it possible
--    to self-insert as admin of an existing group, not just a
--    brand-new one. Real security bug, not just a UX one.

create function public.has_valid_invite(p_group_id uuid, p_role text)
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
  );
$$;

create function public.group_has_no_members(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.group_members gm where gm.group_id = p_group_id
  );
$$;

drop policy "a user can join a group via a valid matching invite" on public.group_members;

create policy "a user can join a group via a valid matching invite"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.has_valid_invite(group_id, role)
  );

drop policy "a user can claim a brand-new empty group as its admin" on public.group_members;

create policy "a user can claim a brand-new empty group as its admin"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and public.group_has_no_members(group_id)
  );
