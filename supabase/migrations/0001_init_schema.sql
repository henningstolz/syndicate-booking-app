-- Core schema: groups, group_members, bookings.
-- Every table is scoped by group_id, and row-level security enforces that
-- a user can only read/write rows belonging to a group they're a member
-- of — enforced in the database, not just trusted to application code.

create extension if not exists pgcrypto;
-- Needed for the booking-overlap exclusion constraint below.
create extension if not exists btree_gist;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  aircraft_registration text not null,
  aircraft_type text,
  home_base text,
  created_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  member_id uuid not null references auth.users (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Bookings are kept forever (cancelled, not deleted) for the audit
  -- trail, so the clash check only excludes overlaps between two rows
  -- that are both still confirmed.
  exclude using gist (
    group_id with =,
    tstzrange (starts_at, ends_at) with &&
  ) where (status = 'confirmed')
);

create index bookings_group_id_starts_at_idx on public.bookings (group_id, starts_at);
create index group_members_user_id_idx on public.group_members (user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.bookings enable row level security;

-- SECURITY DEFINER + empty search_path: these run with elevated
-- privilege to read group_members without recursing into the RLS
-- policy that itself calls this function, and the empty search_path
-- with fully-qualified names avoids a hijacked search_path being able
-- to redirect what "group_members" resolves to.
create function public.is_group_member(p_group_id uuid)
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
  );
$$;

create function public.is_group_admin(p_group_id uuid)
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
  );
$$;

-- groups: members can see their own group(s). No insert/update/delete
-- policy yet — until the "create a group" flow exists, rows are
-- managed directly in the SQL editor as the project owner, which
-- bypasses RLS.
create policy "members can view their groups"
  on public.groups for select
  using (public.is_group_member(id));

-- group_members: members can see who else is in their group(s) (needed
-- for the calendar's member legend). Membership changes are seeded
-- directly for now, same reasoning as groups above.
create policy "members can view their fellow group members"
  on public.group_members for select
  using (public.is_group_member(group_id));

-- bookings: the shared calendar. Members can see every booking in
-- their group, create their own, and cancel their own; admins can
-- cancel anyone's. There is deliberately no delete policy — cancelling
-- sets status = 'cancelled' instead, so the row (and audit trail)
-- stays.
create policy "members can view bookings in their groups"
  on public.bookings for select
  using (public.is_group_member(group_id));

create policy "members can create their own bookings"
  on public.bookings for insert
  with check (
    public.is_group_member(group_id)
    and member_id = auth.uid()
  );

create policy "members can cancel their own bookings, admins any"
  on public.bookings for update
  using (
    public.is_group_member(group_id)
    and (member_id = auth.uid() or public.is_group_admin(group_id))
  );
