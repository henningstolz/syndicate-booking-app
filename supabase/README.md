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
   editable by admins (the Notifications page)

## Adding a member to a group

`group_members` links a Supabase auth user to a group and can't be seeded
in advance, since the user has to sign up first (creating their row in
`auth.users`) before we know their `id`.

Once someone has signed up:

1. Dashboard → **Authentication → Users**, find them, copy their `User UID`
2. Dashboard → **SQL Editor**, run (swap in the real UID and name, and
   `'admin'` only for Henning):

   ```sql
   insert into public.group_members (group_id, user_id, role, display_name)
   select id, '<their-user-uid>', 'member', '<their-name>'
   from public.groups
   where slug = 'g-bbfd';
   ```

## Confirmation emails

Editing Supabase's email templates requires custom SMTP to be configured,
which we're not doing — so we use the **default, unmodified** "Confirm
signup" email as-is. It links through Supabase's own verify endpoint, which
then redirects to the `emailRedirectTo` URL we pass at sign-up
(`/auth/callback`) with a `?code=` parameter.
[`src/app/auth/callback/route.ts`](../src/app/auth/callback/route.ts)
exchanges that code for a session and sets the cookies.

One thing worth checking if confirmation links don't work: Dashboard →
**Authentication → URL Configuration → Redirect URLs** needs to include
`http://localhost:3000/**` (and later, the production URL) — Supabase
rejects `emailRedirectTo` values that aren't on this allow-list.
