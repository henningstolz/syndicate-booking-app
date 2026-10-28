-- Data export for group admins (beta readiness, phase D). The export itself is built by the app
-- from what the admin may already read; this adds the log of who exported what and when, and
-- the one function that decides whether an export may start: the caller must be a current admin
-- of the group, and a group may export at most 5 times an hour.
--
-- Backwards compatible: a new table and a new function; nothing existing changes. The log holds
-- the group, the person and the time, never the contents of the export.

create table public.export_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index export_log_group_idx on public.export_log (group_id, created_at desc);

-- No policy and no rights for the app's users: written only by the function below, read by the
-- owner in the Supabase dashboard.
alter table public.export_log enable row level security;
revoke all on table public.export_log from anon, authenticated;

create function public.log_group_export(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  -- Serialise exports of one group, so two at once cannot slip past the limit.
  perform 1 from public.groups where id = p_group_id for update;
  if (
    select count(*) from public.export_log
    where group_id = p_group_id and created_at > now() - interval '1 hour'
  ) >= 5 then
    return jsonb_build_object('result', 'rate_limited');
  end if;
  insert into public.export_log (group_id, user_id) values (p_group_id, auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.log_group_export(uuid) from public, anon;
grant execute on function public.log_group_export(uuid) to authenticated;
