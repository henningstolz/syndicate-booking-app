-- Aircraft compliance/maintenance status, shown on the Notifications
-- page. These are group-level facts (not per-booking), so they live
-- directly on groups.
alter table public.groups
  add column annual_renewal_due date,
  add column insurance_renewal_due date,
  add column next_check_due date,
  add column hours_to_next_check numeric;

-- groups had no insert/update/delete policy yet (rows were managed
-- directly via SQL as the project owner) — now that admins can edit
-- this status from the app, they need write access to their own
-- group's row.
create policy "admins can update their group"
  on public.groups for update
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));
