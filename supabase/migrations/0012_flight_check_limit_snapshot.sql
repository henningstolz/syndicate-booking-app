-- Each flight entry remembers the check limit ("next check at N hours") that
-- applied when it was logged, so "hours to check after this flight" stays
-- right for old entries (and old printouts) after a check resets the limit.
--
-- Filled by a trigger, so add_flight_entry does not need to change.
-- Backwards compatible: run this BEFORE pushing the matching code.

alter table public.flight_entries
  add column check_limit_hours numeric(8,1);

-- Entries logged so far get the limit that applies now (the best we know).
update public.flight_entries e
set check_limit_hours = g.next_check_at_hours
from public.groups g
where g.id = e.group_id;

create function public.flight_entry_snapshot_check_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.check_limit_hours is null then
    select next_check_at_hours into new.check_limit_hours
    from public.groups
    where id = new.group_id;
  end if;
  return new;
end;
$$;

create trigger flight_entries_snapshot_check_limit
  before insert on public.flight_entries
  for each row
  execute function public.flight_entry_snapshot_check_limit();

revoke all on function public.flight_entry_snapshot_check_limit() from public, anon, authenticated;
