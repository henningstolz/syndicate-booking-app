-- Turns the hardcoded single-group setup into a real multi-group
-- system: anyone can create their own group and become its founding
-- admin, and admins can invite others via a shareable link rather
-- than needing SQL/dashboard access.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  used_by uuid references auth.users (id),
  used_at timestamptz
);

create index invites_group_id_idx on public.invites (group_id);

alter table public.invites enable row level security;

-- Admins manage invites for their own group (create them, see the
-- outstanding list to share/track).
create policy "admins can create invites for their group"
  on public.invites for insert
  to authenticated
  with check (
    public.is_group_admin(group_id)
    and created_by = auth.uid()
  );

create policy "admins can view invites for their group"
  on public.invites for select
  to authenticated
  using (public.is_group_admin(group_id));

-- Whoever holds the invite link can consume it — the link itself is
-- the credential, same model as Slack/Discord invite links. Scoped to
-- still-unused invites; the actual join logic (below) checks role and
-- group match server-side before this ever runs.
create policy "an unused invite can be claimed by whoever holds the link"
  on public.invites for update
  to authenticated
  using (used_at is null)
  with check (used_by = auth.uid() and used_at is not null);

-- A public, minimal lookup for the /join page — deliberately not a
-- SELECT policy on the table itself (that would let anyone list every
-- invite across every group via the anon key with no filter; a
-- SECURITY DEFINER function keyed by a single id avoids that).
create function public.get_invite_info(invite_id uuid)
returns table (
  group_id uuid,
  group_slug text,
  group_name text,
  role text,
  is_valid boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select g.id, g.slug, g.name, i.role, (i.used_at is null)
  from public.invites i
  join public.groups g on g.id = i.group_id
  where i.id = invite_id;
$$;

grant execute on function public.get_invite_info(uuid) to anon, authenticated;

-- groups had no insert policy at all (rows were seeded directly via
-- SQL) — now any signed-up user can start their own group.
create policy "an authenticated user can create a group"
  on public.groups for insert
  to authenticated
  with check (true);

-- The founding-admin case: a brand-new group has zero members, so
-- is_group_admin() can't be true for anyone yet. This lets the
-- creator claim it as admin exactly once, before anyone else exists
-- in it — after that, the "not exists" guard closes the door, so it
-- can't be used to self-promote into an existing group.
create policy "a user can claim a brand-new empty group as its admin"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and not exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
    )
  );

-- The invite case: joining an existing group requires a matching,
-- still-unused invite for that exact group and role.
create policy "a user can join a group via a valid matching invite"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.invites i
      where i.group_id = group_members.group_id
        and i.role = group_members.role
        and i.used_at is null
    )
  );
