# Database setup

Migrations live in `migrations/` as plain SQL. On the **live** project, run
them by hand in the Supabase dashboard: **SQL Editor → New query**, paste a
file's contents, run it — in order, once each. On the **test** project,
`npm run db:migrate` applies them all (and only the new ones next time); try
every migration there first. See `docs/systems-and-accounts.md`.

1. `0001_init_schema.sql` — tables, indexes, and row-level security
2. `0002_seed_group.sql` — the real G-BBFD group row
3. `0003_add_member_display_name.sql` — adds `group_members.display_name`
   (run once; if you added yourself before this existed, also run:
   `update public.group_members set display_name = 'Henning' where display_name is null;`)
4. `0004_add_squawks.sql` — the shared group chat (`squawks` table; first called the message board)
5. `0005_add_aircraft_status.sql` — renewal/check status fields on `groups`,
   editable by admins (the Aircraft page)
6. `0006_group_creation_and_invites.sql` — anyone can create a group and
   becomes its founding admin; admins can invite others via a shareable
   `/join/<id>` link (the `invites` table + `get_invite_info` RPC)
7. `0007_fix_invite_and_claim_rls.sql` — fixes two RLS policies from 0006
   that had raw subqueries subject to their own table's RLS (a joining
   non-member couldn't see the invite they were trying to use; separately,
   a real security gap where any user with no group could self-claim admin
   of an *existing* group, not just a brand-new one)
8. `0008_mark_invite_used_function.sql` — replaces the raw UPDATE + RLS
   policy for marking an invite used (which reliably matched zero rows for
   reasons that resisted diagnosis) with a `mark_invite_used()` SECURITY
   DEFINER function, the same fix pattern as 0007
9. `0009_add_equipment_due_dates.sql` — life raft, life vests and fire
   extinguisher due dates on `groups` (the Aircraft page; adding a further
   field is one entry in `src/lib/aircraft-status.ts` plus a column)
10. `0010_member_management.sql` — group and user management: members can
    be *removed* without losing history (`group_members.removed_at`), roles
    can be changed, anyone can leave, and a group can never end up without an
    admin (all enforced in SECURITY DEFINER functions). Invites gain a name
    label, a 14-day expiry and can be cancelled; joining through an invite is
    now one atomic `accept_invite()` call. Backwards compatible: run it
    *before* pushing the matching code. Tested by `npm run test:db`.

11. `0011_flight_log.sql` — the digital flight log: `flight_entries` (one row per
    flight; block/flight time and decimal hours are calculated by the database
    itself), airframe total hours and the next-check limit on `groups`, and
    functions to add an entry, void one (admin) and set the airframe hours
    (admin). Entries are never edited or deleted. Backwards compatible: run it
    *before* pushing the matching code, because every group page now selects
    the new `groups` columns.

12. `0012_flight_check_limit_snapshot.sql` — each flight entry remembers the check
    limit ("next check at N hours") that applied when it was logged
    (`check_limit_hours`, filled by a trigger), so "hours to check" stays right
    for old entries and old PDFs after a check resets the limit. Existing
    entries get the current limit. Backwards compatible: run it *before*
    pushing the matching code.

13. `0013_email_notifications.sql` — email notifications: members' choices
    (`notification_preferences`), a queue of emails to send (`notification_outbox`),
    triggers that queue an email when a booking is made or cancelled, a chat
    message is posted or a flight is logged, and the functions the server uses
    to claim and report on queued emails with a secret whose hash lives in
    `notification_worker`. Removing a member or leaving a group no longer emails
    once per cancelled booking. Backwards compatible: run it *before* pushing
    the matching code. After it, the secret must be added (see
    docs/systems-and-accounts.md, "Set up email notifications").

14. `0014_reminders.sql` — reminders sent by a timer: a booking reminder the
    evening before, and aircraft reminders for due dates (30 days, 7 days,
    overdue) and for the hours to the next check (10, 5, limit reached). Two
    more events members can switch (`booking_reminder`, `aircraft_reminder`),
    a `reminder_log` so each reminder is sent once, and `queue_reminders()`,
    which the daily job calls with the sender's secret. Backwards compatible:
    run it *before* pushing the matching code.

15. `0015_costs.sql` — hours and costs: `cost_rates` (the fixed monthly share and
    the hourly rate, each valid from a month, with history), `cost_items` (fuel
    and other shared costs, voided never edited), and `cost_statement()`, which
    works out a month for the caller (an admin sees everyone, a member sees
    only themselves). Backwards compatible: run it *before* pushing the
    matching code.

16. `0016_cost_rates_per_member_and_expenses.sql` — costs, second version: no
    shared fuel pot any more. `cost_rates` can hold a member's own rates (a
    `user_id`; an empty part follows the group's), `cost_expenses` holds what a
    member paid for the group (credited on their statement, voided never
    edited), and `cost_statement()` is replaced. Backwards compatible: the old
    `cost_items` table and functions stay until a later clean-up, and the
    statement still returns a `fuel_pence` of 0. Run it *before* pushing the
    matching code.

17. `0017_cleanup_old_join_policy_and_fuel_pot.sql` — removes what nothing uses
    any more: the old direct-insert "join via an open invite" policy (it never
    checked which invite the person held, so anyone who knew a group's id could
    join while an invite was open — a real gap, closed here), `has_valid_invite`,
    `mark_invite_used`, the pooled-fuel table `cost_items` with its functions,
    and the constant `fuel_pence` keys in `cost_statement()`. Backwards
    compatible. Try it on the test project first, then run it on the live one.

## Adding members to a group

Two ways now:

- **The app itself**: any signed-up user with no group can create one at
  `/groups/new` (becomes its admin), and admins can create invite links,
  change roles and remove members from a group's **Settings** page — no SQL
  needed for any of it.
- **Manually, via SQL** (still useful for one-off fixes): swap in the real
  UID and name (find the UID at Dashboard → **Authentication → Users**):

   ```sql
   insert into public.group_members (group_id, user_id, role, display_name)
   select id, '<their-user-uid>', 'member', '<their-name>'
   from public.groups
   where slug = 'g-bbfd';
   ```

## Confirmation emails

Emails are sent through Resend (custom SMTP, sender
`noreply@mail.blocktime.group`, configured in Supabase under Authentication,
then SMTP Settings). The email templates could now be edited, but we still use
the **default, unmodified** "Confirm signup" email. It links through Supabase's
own verify endpoint, which
then redirects to the `emailRedirectTo` URL we pass at sign-up
(`/auth/callback`) with a `?code=` parameter.
[`src/app/auth/callback/route.ts`](../src/app/auth/callback/route.ts)
exchanges that code for a session and sets the cookies.

One thing worth checking if confirmation links don't work: Dashboard →
**Authentication → URL Configuration → Redirect URLs** needs to include
`http://localhost:3000/**` (and later, the production URL) — Supabase
rejects `emailRedirectTo` values that aren't on this allow-list.
