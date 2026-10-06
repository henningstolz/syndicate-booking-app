# Database setup

Migrations live in `migrations/` as plain SQL. Until we set up the Supabase
CLI, run them by hand in the Supabase dashboard: **SQL Editor → New query**,
paste a file's contents, run it — in order, once each.

1. `0001_init_schema.sql` — tables, indexes, and row-level security
2. `0002_seed_group.sql` — the real G-BBFD group row
3. `0003_add_member_display_name.sql` — adds `group_members.display_name`
   (run once; if you added yourself before this existed, also run:
   `update public.group_members set display_name = 'Henning' where display_name is null;`)
4. `0004_add_squawks.sql` — the shared message board (`squawks` table)
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
