-- More aircraft "due" dates, shown with the existing renewal/check
-- status on the Aircraft page. Same shape as the earlier ones: plain
-- nullable dates on groups, editable by admins through the existing
-- "admins can update their group" policy.
alter table public.groups
  add column life_raft_due date,
  add column life_vests_due date,
  add column fire_extinguisher_due date;
