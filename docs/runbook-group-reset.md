# Runbook: a fresh start for a group that stays

For when a group has been used for testing and should start clean, keeping the group itself, its plan and
one admin. (Deleting a whole group is `docs/runbook-group-deletion.md`.) Used once so far: the first real
group, g-bbfd, on 2026-11-22.

## What it does

Keeps: the group (name, address name, registration, type, home base), its plan and plan history, ONE admin
(chosen by sign-in email), every account, each person's own acceptance of the terms.

Deletes: all other memberships (accounts stay; the people can rejoin through a new invite link), bookings,
chat, the whole tech log, expenses, payments, closed months, cost rates, billing basis, documents (the list;
the files by hand), invite links, calendar links, feedback, the export log, the reminder memory, the email
queue and the notification choices.

Resets: the equipment list goes back to the four starter items without dates; the annual, insurance and
next-check dates are cleared; the airframe hours are set to the figures entered. (Total hours = baseline +
logged flights, so deleting flights without setting the baseline would lower the real airframe hours. The
script sets it.)

## Steps

1. **Agree what stays.** The people who stay (and who must rejoin), whether rates and dates are kept. The
   script as written resets the setup too; remove the lines under "Setup" if that is not wanted.
2. **Have the real figures to hand:** the airframe total hours from the logbook and the hours at which the
   next check is due.
3. **Backup.** Actions, **Daily database backup**: run it by hand now and wait for green. This is the only way
   back.
4. **Open `scripts/ops/reset-group.sql`** in the live SQL editor and run its blocks one at a time, with the
   group's address name, the staying admin's email and the two hour figures filled in:
   1. **Look** (changes nothing): check it is the right group, who is in it, what will be deleted.
   2. **The files** (changes nothing): in the Supabase dashboard, Storage, the `documents` bucket, open the
      folder named after the group's id, select everything and delete it.
   3. **Reset:** one statement, all or nothing. It stops with a message and changes nothing if the group or
      the email is wrong, the person is not a current admin, or the hours are missing.
   4. **Check it:** one member, four equipment items, none with a date, no history, the airframe hours you
      entered, the plan unchanged.
5. **Afterwards, in the app:** sign in, check the dashboard and the Aircraft page, enter the annual,
   insurance and next-check dates and the equipment dates, set the cost rates (and billing basis) from the
   month you start, send out new invite links. The calendar links of everyone stopped working, so each
   member makes a new one under Account, Calendar.

The routine is covered by `supabase/tests/group-reset.test.mjs`, which runs the real script's reset block
against a group with data in every table, checks another group is untouched, and fails if a new table with a
`group_id` is ever forgotten.
