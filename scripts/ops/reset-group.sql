-- Fresh start for ONE group that stays: its history and setup are wiped, the group itself, the plan and one
-- admin remain. Run each block on its own in the LIVE Supabase SQL editor (the editor shows only the result of
-- the last statement of a run). The routine, with the checks before and after, is docs/runbook-group-reset.md.
--
-- What is KEPT:    the group (name, address name, registration, aircraft type, home base), its plan and plan
--                  history, ONE admin member (the person whose email you enter below), every account, and each
--                  person's own acceptance of the terms.
-- What is DELETED: all other memberships, bookings, the aircraft's unavailable periods, chat, the whole tech log, expenses, payments, closed months,
--                  cost rates and billing basis, documents (the list; the files are removed in the dashboard,
--                  block 2), invite links, calendar links, feedback, the export log, the reminder memory, the
--                  email queue and the notification choices.
-- What is RESET:   the equipment list goes back to the four starter items without dates; the annual, insurance
--                  and next-check dates are cleared; the airframe hours are set to the figures you give.
--
-- Replace THE-GROUP-SLUG (the part after blocktime.group/ in the group's address), YOUR-EMAIL-HERE (the sign-in
-- email of the admin who stays) and the two hour figures in block 3. There is no undo: take the backup first.

-- ---------------------------------------------------------------- 1. LOOK (changes nothing)
select g.id, g.slug, g.name, g.aircraft_registration, g.aircraft_type, g.home_base, g.airframe_total_hours, g.next_check_at_hours,
  (select p.plan from public.group_plans p where p.group_id = g.id) as plan
from public.groups g
where g.slug = 'THE-GROUP-SLUG';

-- the people in it (the first one you keep, the others are removed from the group; their accounts stay)
select m.display_name, m.role, m.removed_at is not null as removed, u.email
from public.group_members m
join auth.users u on u.id = m.user_id
where m.group_id = (select id from public.groups where slug = 'THE-GROUP-SLUG')
order by m.role, m.display_name;

-- what will be deleted, counted
select
  (select count(*) from public.bookings b where b.group_id = g.id) as bookings,
  (select count(*) from public.flight_entries f where f.group_id = g.id) as flight_entries,
  (select count(*) from public.squawks s where s.group_id = g.id) as chat_messages,
  (select count(*) from public.cost_expenses e where e.group_id = g.id) as expenses,
  (select count(*) from public.cost_payments p where p.group_id = g.id) as payments,
  (select count(*) from public.cost_month_closures c where c.group_id = g.id) as closed_months,
  (select count(*) from public.documents d where d.group_id = g.id) as documents,
  (select count(*) from public.invites i where i.group_id = g.id) as invites
from public.groups g
where g.slug = 'THE-GROUP-SLUG';

-- ----------------------------------------------- 2. THE FILES (changes nothing; they are NOT removed by SQL)
-- Their folder is named after the group's id. In the Supabase dashboard, Storage, the documents bucket: open that
-- folder, select everything and delete it. Uploaded receipts are in the same folder.
select o.name, (o.metadata->>'size')::bigint as bytes
from storage.objects o
where o.bucket_id = 'documents'
  and (storage.foldername(o.name))[1] = (select id::text from public.groups where slug = 'THE-GROUP-SLUG')
order by o.name;

-- ---------------------------------------------------------------- 3. RESET (all or nothing)
-- BEGIN RESET
do $reset$
declare
  c_slug constant text := 'THE-GROUP-SLUG';
  c_keep_email constant text := 'YOUR-EMAIL-HERE';
  c_airframe_total_hours constant numeric := null;   -- the airframe's total hours from the logbook, e.g. 5871.4
  c_next_check_at_hours constant numeric := null;    -- the airframe hours at which the next check is due, e.g. 5900.0
  v_group uuid;
  v_keep uuid;
begin
  if c_airframe_total_hours is null or c_airframe_total_hours < 0 or c_airframe_total_hours > 99999 then
    raise exception 'Enter the airframe total hours (c_airframe_total_hours) first.';
  end if;
  if c_next_check_at_hours is not null and (c_next_check_at_hours < 0 or c_next_check_at_hours > 99999) then
    raise exception 'c_next_check_at_hours is not a sensible number.';
  end if;

  select id into v_group from public.groups where slug = c_slug;
  if v_group is null then
    raise exception 'No group with the address name %.', c_slug;
  end if;

  select u.id into v_keep from auth.users u where lower(u.email) = lower(c_keep_email);
  if v_keep is null then
    raise exception 'No account with the email %.', c_keep_email;
  end if;
  if not exists (
    select 1 from public.group_members m
    where m.group_id = v_group and m.user_id = v_keep and m.role = 'admin' and m.removed_at is null
  ) then
    raise exception '% is not a current admin of the group %, so nobody would be left to run it.', c_keep_email, c_slug;
  end if;

  -- History. Expenses first: they can point at a receipt in documents.
  delete from public.cost_expenses where group_id = v_group;
  delete from public.documents where group_id = v_group;
  delete from public.cost_payments where group_id = v_group;
  delete from public.cost_month_closures where group_id = v_group;
  delete from public.aircraft_downtime where group_id = v_group;
  delete from public.bookings where group_id = v_group;
  delete from public.squawks where group_id = v_group;
  delete from public.flight_entries where group_id = v_group;
  delete from public.invites where group_id = v_group;
  delete from public.calendar_feeds where group_id = v_group;
  delete from public.feedback where group_id = v_group;
  delete from public.export_log where group_id = v_group;
  delete from public.reminder_log where group_id = v_group;

  -- Setup.
  delete from public.cost_rates where group_id = v_group;
  delete from public.cost_billing_basis where group_id = v_group;
  delete from public.notification_preferences where group_id = v_group;
  delete from public.aircraft_items where group_id = v_group;
  insert into public.aircraft_items (group_id, label, position) values
    (v_group, 'Life raft', 1), (v_group, 'Life vests', 2), (v_group, 'Fire extinguisher', 3), (v_group, 'First aid kit', 4);

  -- People: only the one admin stays (their accounts are not touched).
  delete from public.group_members where group_id = v_group and user_id <> v_keep;

  -- The aircraft's dates and hours. With the log empty, total = baseline.
  update public.groups
  set annual_renewal_due = null,
      insurance_renewal_due = null,
      next_check_due = null,
      hours_to_next_check = null,
      life_raft_due = null,
      life_vests_due = null,
      fire_extinguisher_due = null,
      airframe_hours_baseline = round(c_airframe_total_hours, 1),
      next_check_at_hours = round(c_next_check_at_hours, 1)
  where id = v_group;
  perform public.recalc_airframe_hours(v_group);

  -- Last: anything the deletions above may have queued.
  delete from public.notification_outbox where group_id = v_group;
end
$reset$;
-- END RESET

-- ---------------------------------------------------------------- 4. CHECK IT (changes nothing)
-- One member (you), four equipment items without dates, everything else 0; the plan unchanged.
select
  (select count(*) from public.group_members m where m.group_id = g.id) as members,
  (select count(*) from public.aircraft_items a where a.group_id = g.id) as equipment_items,
  (select count(*) from public.aircraft_items a where a.group_id = g.id and a.due_date is not null) as equipment_with_dates,
  (select count(*) from public.bookings b where b.group_id = g.id)
    + (select count(*) from public.flight_entries f where f.group_id = g.id)
    + (select count(*) from public.squawks s where s.group_id = g.id)
    + (select count(*) from public.cost_expenses e where e.group_id = g.id)
    + (select count(*) from public.cost_payments p where p.group_id = g.id)
    + (select count(*) from public.cost_month_closures c where c.group_id = g.id)
    + (select count(*) from public.documents d where d.group_id = g.id)
    + (select count(*) from public.invites i where i.group_id = g.id) as history_rows,
  g.airframe_total_hours, g.next_check_at_hours, g.hours_to_next_check,
  (select p.plan from public.group_plans p where p.group_id = g.id) as plan
from public.groups g
where g.slug = 'THE-GROUP-SLUG';
