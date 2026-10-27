# The platform admin page

`/platform-admin` is the page for the person who runs Blocktime. It lists every group with its
plan, lets you change a group's plan (with a reason that is written into a history that cannot be
edited) and the platform-wide settings. Nothing else.

## What it can and cannot see

It reads and writes only through the admin functions in the database (migration 0025). It shows, for
each group: name, address name, member count, aircraft count (always 1 for now), the group admins'
names and email addresses, plan fields, created date and last activity. It **never** shows bookings,
flight log, costs, chat or documents, and no member emails other than the group admins'. There is no
service-role key anywhere in the app.

## Who can open it

Only people listed in `platform_admins`, and only after entering a code from an authenticator app.
Everyone else (signed out, an ordinary member, a group admin) gets the plain "404" page, as if the
address did not exist. There is no link to it anywhere. Open it by typing the address
`https://blocktime.group/platform-admin` (or bookmark it) **after** signing in as usual.

## Becoming a platform admin (one time)

1. Run the one-line insert in the Supabase SQL editor (see `docs/runbook-migrations.md`, "Migration
   0025").
2. Sign in to the app, open `/platform-admin`. The first time you are asked to set up an authenticator
   app: scan the QR code with an app such as 1Password, Google Authenticator or Microsoft Authenticator,
   and type the 6-digit code. Setting it up signs you out on your other devices once.
3. From then on: sign in as usual, open `/platform-admin`, type the code.
4. Add a second device under **Security** at the bottom of the page (a backup, so a lost phone does not
   lock you out).

Do step 2 straight after step 1. Until the first authenticator exists, the account is protected by its
password only (checked on the test project: once a verified authenticator exists, someone with only the
password cannot add their own or remove yours; Supabase refuses with "AAL2 required").

To remove an admin, delete their row from `platform_admins`.

## Using it

- **Summary:** groups by plan, trials ending and paid-until dates in the next 30 days, and how many
  groups would be read-only if billing enforcement were on today.
- **Groups:** search, sort and filter; click a group to edit it. Only the fields you change are saved.
  A reason (at least 3 characters) is required and appears in the history under the group.
- **Settings:** plan and cohort for new groups, the paid-beta cut-off date, the grace period. Each change
  needs a reason and is logged.
- **Billing enforcement** is off. Switching it on goes through a confirmation page that says how many groups
  would be limited and requires typing ENABLE. Read `docs/entitlements.md` first: until the same check is
  also made inside the database, enforcement is applied in the app only.

## Lost phone or authenticator

You cannot open the admin page, but the rest of the app works normally. Recover in the Supabase
dashboard: Authentication, Users, open your user, and remove the authenticator factor (a "factor" is the
entry for the app). Then open `/platform-admin` again and set up a new one. If you added a second
device earlier (recommended), simply use that.

## If something looks wrong

A 404 for yourself means one of: not signed in, not in `platform_admins`, or the wrong project. A
"code did not work" message usually means the phone's clock is off, or the code just expired.
