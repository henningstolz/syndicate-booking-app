# Runbook: deleting a group (and a person's data)

There is no self-service deletion. A group's admin asks, you check, export first, then delete by hand.
The privacy page promises this is done "normally within one month".

## 1. The request

- It arrives by email at support@blocktime.group (or the Feedback button).
- **Check who is asking.** It must be an admin of that group. Reply to the address the group knows them by
  and ask them to confirm from their Blocktime account email; if in doubt, ask another admin.
- Say what will happen: the group's information is deleted, there is no undo, backups age out within a year,
  and you will send them an export first.

## 2. Export first

Ask the admin to download the export themselves (Settings, **Export your data**). If they cannot, you can do
the same signed in as an admin of the group only if they invite you; never read a group's data to produce it.
Keep nothing of the export yourself.

## 3. Check a fresh backup exists

The nightly backup (Actions, Daily database backup) should be green and from the last 24 hours, in case the
request turns out to be a mistake. After deletion the group is still in older backups for up to a year (said
on the privacy page).

## 4. Delete it

Open `scripts/ops/delete-group.sql` and run its blocks one at a time in the **live** SQL editor, replacing
`THE-GROUP-SLUG`:

1. **Look** (counts): check it is the right group, with the right name and registration.
2. **The files:** the list of uploaded files. Files are not removed by SQL. In the Supabase dashboard, Storage,
   open the `documents` bucket, open the folder named after the group's id (the first part of every path in
   the list), select all and delete. Do this **before** step 3.
3. **Delete:** one statement. It removes the group and everything that belongs to it (members' memberships,
   bookings, flight log, chat, costs, documents list, invitations, calendar links, feedback, plan, export log).
   This is covered by a test that deletes a group with data in every table (`supabase/tests/exports.test.mjs`).
4. **People without a group:** a list for you to decide on. Accounts are not deleted automatically, because a
   person may use Blocktime in another group, or want to keep their account.
5. **A person's account:** only on request, and only if they belong to nothing else.

What stays, deliberately: the history of plan changes (`plan_events`) with ids and plan values only, and each
person's own record of accepting the terms (without the group). Both hold no names or email addresses.

## 5. Tell them

Confirm to the admin that the group has been deleted, and that copies in encrypted backups expire within a year.

## One person leaving, not a whole group

Handled case by case. Usually: remove them from the group (Settings, Members). Their name stays on past
bookings and flight entries so the group's records remain correct. If they ask for their name to be removed
too, change their display name in `group_members` to something neutral (for example `Former member`) with an
`update`, after checking with the group's admin. Deleting the account itself is step 5 above, once nothing
points at it.
