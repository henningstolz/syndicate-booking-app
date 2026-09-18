-- A simple shared message board — any member can post, every member
-- sees every post. No status/resolve tracking for now (that's a
-- later, separate concern if a real defect-tracking flow is wanted);
-- this is deliberately just "everyone can share info with the group".
create table public.squawks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  message text not null,
  created_at timestamptz not null default now()
);

create index squawks_group_id_created_at_idx on public.squawks (group_id, created_at desc);

alter table public.squawks enable row level security;

-- Same pattern as bookings: no update/delete policy, so posts are a
-- permanent record once made — consistent with the audit-trail
-- approach used elsewhere in this app.
create policy "members can view squawks in their groups"
  on public.squawks for select
  using (public.is_group_member(group_id));

create policy "members can post squawks in their groups"
  on public.squawks for insert
  with check (
    public.is_group_member(group_id)
    and author_id = auth.uid()
  );
