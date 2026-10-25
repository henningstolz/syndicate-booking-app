# Runbook: restoring Blocktime from a backup

Two situations: a **practice drill** (do it after big changes and a few times a year)
and a **real recovery** (the live project is lost or damaged). Both use the same
nightly backup. Read "What a backup holds" first; it is short.

## What a backup holds, and what it does not

| Held in the nightly backup | Not held (must be set up again by hand) |
| --- | --- |
| Everything in the app's database: groups, members, bookings, flight log, chat, costs, payments, documents list, feedback, notification choices and queue, the fingerprint of the notification secret | The stored files themselves **are** copied (folder `files/` inside the backup), but they are not put back by the database restore: a second step does that |
| The sign-in accounts (emails and scrambled passwords) | Supabase Auth **settings**: Site URL, redirect URLs, SMTP, email templates, MFA |
| The files in the `documents` bucket (documents and receipts) | The file **rules** (bucket settings and who may open what): migration 0023 puts them back |
| | Vercel settings and secrets, DNS, the Resend and Sentry accounts |

Every backup is **restored into a scratch database and compared** before it is stored, so
a green nightly run means the database part restores. The drill below proves the same on
a real Supabase project, and times it.

## 1. The practice drill (about 5 minutes of your time)

It restores the newest LIVE backup into the **TEST** project, which it empties first, so
the TEST project then holds a copy of the real data (real emails included).

1. GitHub, the code repository, **Actions**, **Restore drill (into the TEST project)**,
   **Run workflow**, type `empty the test project`, Run.
2. It finishes in a few minutes. Green means: the backup opened, the copy matches the
   original (tables, security rules, who may call which function, row counts), and the
   check in `scripts/db/verify-restore.mjs` found people, bookings, flight log entries and
   a closed month in the copy. The run's summary page shows how long it took.
   The logs are public, so they contain only yes or no answers, never data.
3. Look at the copy on your Mac (it shows dates and group addresses, never printed in
   public):

   ```bash
   node scripts/db/verify-restore.mjs --skip-files
   ```

   Then `npm run dev` with the TEST settings, sign in with your real account (the passwords
   came across) and open a booking and a tech log page from the routes it printed.
4. Empty the test project again:

   ```bash
   npm run db:reset-test -- --yes
   npm run db:migrate
   ```

The drill covers the database only. The files step (3, below) is done by hand and needs the
S3 key of the project you restore into; a real recovery is the place to do it.

Record each drill here:

| Date | Schema | Job time | Your own time | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-08 | before documents, payments, calendar and feedback existed | 1.3 min | not recorded | first drill; needed three fixes |
| 2026-10-25 | migrations 0001 to 0024 (all) | 1 min 46 s | about 5 min | green; sign-in with a real account, calendar, tech log and a closed month checked on the restored copy; files not part of the drill |
|  |  |  |  |  |

## 2. A real recovery (the live project is gone)

Order matters. The website stays down until step 8, so keep going without breaks.

**Before you start:** the backup passphrase (your password manager), a GitHub login that
can read `blocktime-backups`, a Mac with `psql`, `pg_dump`, `pg_restore` version 17
(`brew install postgresql@17`) and the `aws` command line tool.

1. **Get the newest backup.** The private repository `blocktime-backups`, Releases, the
   newest `backup-….tar.enc`. If the newest looks wrong (too small, or failed that night),
   use the one before it; thirty are kept.
2. **Unpack it.**

   ```bash
   BACKUP_PASSPHRASE='…' scripts/backup/encrypt.sh unpack backup-YYYY-MM-DD.tar.enc /tmp/restore
   ```

3. **Make a new, empty Supabase project.** Region London, same plan as before. (Do not
   restore over the old project, even if it still exists: the script refuses a database that
   already has tables.) Copy its Session pooler connection string, and from Project
   Settings, API, the project URL and the public (anon) key.
4. **Restore the database** (it ends with `RESTORE VERIFIED`):

   ```bash
   scripts/backup/restore.sh '<session pooler connection string>' /tmp/restore
   ```

5. **Put the file rules back.** In the new project's SQL editor run
   `supabase/migrations/0023_documents_storage.sql` (safe to run on a restored database; it
   creates the `documents` bucket and the rules).
6. **Put the files back.** In the new project: Project Settings, Storage, S3, create an
   access key. Then:

   ```bash
   aws configure set default.s3.addressing_style path
   AWS_ACCESS_KEY_ID='…' AWS_SECRET_ACCESS_KEY='…' AWS_DEFAULT_REGION='…' \
     aws s3 sync /tmp/restore/files s3://documents --endpoint-url '<the S3 endpoint shown there>'
   ```

   Check the count matches: the documents list in the database and the stored files must
   be the same number (`scripts/db/verify-restore.mjs` says so, but only for the TEST
   project; for the new live project compare the Table Editor row count of `documents`
   with Storage, `documents` bucket). A file that did not come across will not
   open; fix it by running the sync again.
7. **Set up sign-in again** in the new project, Authentication:
   - URL Configuration: Site URL `https://blocktime.group`; Redirect URLs include
     `https://blocktime.group/**`.
   - SMTP: Resend's SMTP details, sender `noreply@mail.blocktime.group` (so sign-up and
     password-reset emails work).
   - Email templates: the same wording as before (the repository does not hold them; the
     old project's page, if it is still reachable, or the Supabase defaults).
   - Migrations are not needed: the restore brought the structure with it. If the backup is
     older than the newest file in `supabase/migrations/`, run the missing ones now, in order.
8. **Point the website at it.** Vercel, Settings, Environment Variables (Production):
   replace `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then Redeploy.
   `NOTIFY_TOKEN` and `CRON_SECRET` stay as they are; the fingerprint of `NOTIFY_TOKEN` is
   part of the restored data, so emails keep working.
9. **Update the GitHub secrets** used by the nightly backup: `BACKUP_DATABASE_URL` (the new
   Session pooler string) and the `BACKUP_S3_*` ones (the new S3 key). Run **Daily database
   backup** once by hand and check it is green.
10. **Update this repository's records:** the project reference in
    `scripts/db/connection.mjs` (`LIVE_PROJECTS`), `.github/workflows/restore-drill.yml`
    and `schema-check.yml` (they refuse the live project by its reference), and
    `docs/systems-and-accounts.md`.

**Check it worked.** Open `https://blocktime.group/api/health` (must say `{"ok":true}`),
sign in, open the calendar, the tech log and a closed month's statement, open one
document and one receipt, and send yourself a test email from Account, Notifications.
Then tell the groups what happened.

## 3. What can go wrong

- **The restore stops with a permissions error.** Supabase's own default permissions: the
  script already skips those entries; if a new kind appears, the drill (section 1) is where
  it shows first, which is why it is worth running after Supabase changes things.
- **People are signed out everywhere.** Expected: the new project has new signing keys.
  Everyone signs in again with their old password.
- **Calendar links stop working.** They point at `https://blocktime.group/cal/…`, which
  keeps working because the secrets are in the restored data.
- **Files are missing.** The backup's `files/` folder was empty because the `BACKUP_S3_*`
  secrets were not set that night (the backup run shows a warning). Older backups may have
  the files; try the previous one.
