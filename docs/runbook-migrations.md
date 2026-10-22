# Runbook: changing the live database

The rule: **the repository is the only source of truth for the database's structure.**
Every change is a numbered file in `supabase/migrations/`. Nothing is changed by clicking
in the Supabase dashboard (the Table Editor and the SQL editor's ad-hoc queries are for
looking, not for changing).

## The steps, every time

1. **Write the migration** as the next numbered file. Write it so it can be run twice
   safely where that is easy (`create ... if not exists`, `create or replace`, `drop policy
   if exists`). Write the tests in `supabase/tests/` in the same change.
2. **Run `npm test`.** It applies every migration to a throwaway database and runs all the
   tests, so a mistake in the file shows up here.
3. **Apply it to TEST:** `npm run db:migrate`. Check the feature against the TEST project
   (locally, or on a Vercel preview that points at TEST).
4. **Check there is a fresh backup.** GitHub, Actions, **Daily database backup**: the newest
   run must be green and from the last 24 hours. If it is older, run it by hand and wait for
   green. Do not start a live migration without this.
5. **Apply it to LIVE.** Supabase, the live project (`blocktime`), SQL Editor: paste the whole
   file, check the project name in the top left, Run. It should say Success.
6. **Check it took.** Actions, **Schema check (LIVE against TEST)**, Run workflow. Green means
   the live structure equals what the migrations build. If it names a part that differs,
   stop and tell Claude which one.
7. **Then merge/push the code** that needs the new structure. Order matters: the database
   change first, because the old code must keep working with the new structure. Write
   migrations so that is true (add columns and functions; remove things only in a later
   migration, after the code no longer uses them).

If a live migration fails halfway, the editor rolls the whole file back (a file is one
transaction unless it says otherwise). Read the error, fix the file, test again from
step 2. Never repair the live database by hand and leave the file unchanged.

## What is NOT in the migration files

These are changed by hand, so each is a place where live and the repository can drift.
Note any change to them in `docs/systems-and-accounts.md`.

| Where | What | Check |
| --- | --- | --- |
| Supabase, Authentication | Site URL, redirect URLs, SMTP, email templates, sign-up settings, (later) MFA | Compare with `docs/runbook-restore.md`, section 2, step 7 |
| Supabase | The `notification_worker` row (a fingerprint of `NOTIFY_TOKEN`), set once | `docs/systems-and-accounts.md`, "Set up email notifications" |
| Supabase, Storage | The S3 key used by the backup | GitHub secrets `BACKUP_S3_*` |
| Vercel | Every environment variable | The inventory in `docs/systems-and-accounts.md` |
| Supabase / GitHub / Vercel | Account logins and plans | The same inventory |
| (later) the first platform admin | A one-off insert after the admin migration | Named in that phase's hand-over |

## Rolling back

Migrations only go forward. To undo one, write the next numbered migration that reverses
it, and test it like any other. For a disaster (bad data, dropped table) restore from a
backup: `docs/runbook-restore.md`.

## Before charging anyone

The free **Vercel Hobby** plan is for non-commercial use. Move the project to a paid Vercel
plan before the first paid group. Supabase's free plan also pauses a project that is idle
for a week; the uptime monitor keeps live awake, but a paid plan adds proper backups and
removes the risk.
