# Database setup

Migrations live in `migrations/` as plain SQL. Until we set up the Supabase
CLI, run them by hand in the Supabase dashboard: **SQL Editor → New query**,
paste a file's contents, run it — in order, once each.

1. `0001_init_schema.sql` — tables, indexes, and row-level security
2. `0002_seed_group.sql` — the real G-BBFD group row

## Adding a member to a group

`group_members` links a Supabase auth user to a group and can't be seeded
in advance, since the user has to sign up first (creating their row in
`auth.users`) before we know their `id`.

Once someone has signed up:

1. Dashboard → **Authentication → Users**, find them, copy their `User UID`
2. Dashboard → **SQL Editor**, run (swap in the real UID, and `'admin'` only
   for Henning):

   ```sql
   insert into public.group_members (group_id, user_id, role)
   select id, '<their-user-uid>', 'member'
   from public.groups
   where slug = 'g-bbfd';
   ```

## One-time auth email template change

Supabase's default "Confirm signup" email links straight to Supabase's own
server, which doesn't leave our app holding a session. Dashboard →
**Authentication → Email Templates → Confirm signup**, replace the link's
href with:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/login
```

That points at [`src/app/auth/confirm/route.ts`](../src/app/auth/confirm/route.ts),
which verifies the token and sets the session cookies itself. Without this
change, clicking the confirmation email link won't sign the user in.
