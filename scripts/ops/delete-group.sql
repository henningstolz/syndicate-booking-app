-- Deleting a whole group, step by step. Run each block on its own in the LIVE Supabase SQL editor
-- (the editor shows only the result of the last statement of a run). The full routine, with the checks
-- before and after, is docs/runbook-group-deletion.md. Replace THE-GROUP-SLUG with the group's address
-- name (the part after blocktime.group/ in its address).

-- ---------------------------------------------------------------- 1. LOOK (changes nothing)
select g.id, g.slug, g.name, g.created_at,
  (select count(*) from public.group_members m where m.group_id = g.id) as members,
  (select count(*) from public.bookings b where b.group_id = g.id) as bookings,
  (select count(*) from public.flight_entries f where f.group_id = g.id) as flight_entries,
  (select count(*) from public.squawks s where s.group_id = g.id) as chat_messages,
  (select count(*) from public.documents d where d.group_id = g.id) as documents
from public.groups g
where g.slug = 'THE-GROUP-SLUG';

-- ----------------------------------------------- 2. THE FILES (changes nothing; they are NOT removed by SQL)
-- Their folder is named after the group's id. Delete that folder in the dashboard (Storage, the documents
-- bucket) BEFORE step 3, because after step 3 the id is gone from the database.
select o.name, (o.metadata->>'size')::bigint as bytes
from storage.objects o
where o.bucket_id = 'documents'
  and (storage.foldername(o.name))[1] = (select id::text from public.groups where slug = 'THE-GROUP-SLUG')
order by o.name;

-- ---------------------------------------------------------------- 3. DELETE (one statement, all or nothing)
-- Removes the group and, through it, its members' memberships, bookings, flight log, chat, costs, documents
-- list, invitations, calendar links, feedback, plan and export log. Each person's own acceptance of the terms
-- stays, detached from the group. The history of plan changes (plan_events) stays: ids only, by design.
delete from public.groups where slug = 'THE-GROUP-SLUG' returning id, slug, name;

-- ------------------------------------------ 4. PEOPLE LEFT WITHOUT ANY GROUP (changes nothing; decide case by case)
-- Accounts that now belong to no group. Delete one only if the person asked for it (step 5).
select u.email, u.created_at
from auth.users u
where not exists (select 1 from public.group_members m where m.user_id = u.id and m.removed_at is null)
order by u.created_at;

-- ---------------------------------------------------------------- 5. DELETE ONE PERSON'S ACCOUNT (only on request)
-- Fails with an error, and changes nothing, if anything in another group still points at them.
-- delete from auth.users where email = 'person@example.com' returning id;
