# Blocktime: systems, accounts and how-tos

Everything outside the code that Blocktime depends on, who to log in as, and
how to do the common jobs. For how the code fits together, see
[architecture.md](architecture.md).

_Last updated 5 October 2026._

**No passwords or secret keys are written in this file, and none should be.**
Keep them in a password manager. The "Where the secret lives" column says
where each one is stored.

## Inventory

| # | System | What it does for Blocktime | Where to log in | Where the secret lives |
| --- | --- | --- | --- | --- |
| 1 | **GitHub** (`henningstolz/syndicate-booking-app`) | Holds the code and its history. A push to `main` starts a deploy. | github.com | Your Mac pushes with an SSH key. |
| 2 | **Vercel** (project `syndicate-booking-app-ukds`) | Builds and hosts the website. Also hosts the DNS for `blocktime.group`. | vercel.com | Environment variables are stored in the project's Settings. |
| 3 | **Supabase** (live project, named `blocktime`, ref `trdtqhkbxssujcwmvham`, London) | The database, sign-in, and the SQL editor where migrations are run. | supabase.com/dashboard | Project keys are under Settings, then API. |
| 4 | **Resend** (EU region) | Sends email: sign-up confirmations, the notification emails members choose, and mail you send as `hello@`. | resend.com | API keys: one inside Supabase's SMTP settings, one in Gmail's "send as", one in Vercel for notifications. |
| 5 | **ImprovMX** | Forwards `hello@blocktime.group` to your personal inbox. | improvmx.com | Account login only. |
| 6 | **Gmail** (your personal account) | Receives `hello@` mail and sends as it. | gmail.com | Holds the "send as" Resend key. |
| 8 | **GitHub, a second private repository** (`blocktime-backups`) | Holds the nightly encrypted database backups (as releases). Nothing else. | github.com | A token in the code repository's Actions secrets (`BACKUP_REPO_TOKEN`), and the backup passphrase, which also lives in your password manager. |
| 9 | **Supabase, a second project** (`blocktime-test`, ref `ojxvrtlttppyjygjfapm`) | The test database: where new changes are tried before they touch the live one. Holds only made-up data. | supabase.com/dashboard | Its connection string is `TEST_DATABASE_URL` in `.env.local` on your Mac. |
| 7 | **Domain registrar for `blocktime.group`** | Owns the domain name and renews it every year. | _Write down where you registered it_ | Account login only. |

**To fill in yourself** (I can't see these, and they are what you'd lose track
of first): which email address each account is registered under, which
registrar holds the domain and when it renews, and which plan each service is
on.

### The three Resend keys

You have three separate keys on purpose, so one can be revoked without breaking
the others.

- **Supabase's SMTP key.** Has access to all domains. Used by Supabase to send
  sign-up emails. Lives in Supabase, then Authentication, then SMTP Settings.
- **Gmail's "send as" key.** Sending-only, limited to `blocktime.group`. Lives
  in Gmail's Send mail as settings.
- **The notifications key.** Sending-only, limited to `mail.blocktime.group`.
  Lives in Vercel's environment variables as `RESEND_API_KEY`.

If Resend reports an invalid or restricted key, check its permission and
domain access first.

## What breaks if something is lost

| If this goes away… | …this stops |
| --- | --- |
| Vercel project or account | The website and app go offline. DNS also lives here, so email stops too. |
| Supabase project | Everything: all data and all sign-ins. Most important thing to protect. |
| Resend account or key | Sign-up confirmation emails (so new people can't join) and your replies from `hello@`. |
| ImprovMX | Mail to `hello@` bounces. |
| The domain registration lapsing | The whole domain: website, sign-in links, email. |
| GitHub | The code's history. The live site keeps running, but you could no longer deploy changes. |

## Things worth checking (plan limits)

These depend on the plan you chose, which I can't see. Check each.

- **Supabase free projects pause after a period of inactivity** and must be
  restored by hand in the dashboard. A paused project takes the whole app down.
  A paid plan avoids this and adds automatic backups.
- **Backups.** A free Supabase plan has no usable automatic backups, so this
  project makes its own every night (see "Backups" below). A paid plan would
  add Supabase's own on top.
- **Vercel's free (Hobby) plan is for non-commercial use.** Fine for a group
  of friends. If Blocktime ever charges money, move to a paid plan.
- **Resend's free plan has daily and monthly sending limits.** Plenty for
  sign-up emails at this size.
- **Domain renewal.** Turn on auto-renew at your registrar.
- **Resend's free plan** allows about 100 emails a day and 3,000 a month, shared by sign-up emails and notifications. Fine for a few pilots; a busy group with every option on could approach it.
- **The demo does not use Supabase,** so it stays up even when the database is paused or over its limits.

## How-tos

### Run a database change (migration)

Migrations are plain SQL files in `supabase/migrations/`, numbered in order.

1. **Try it on the test project first:** `npm run db:migrate` (see "The test
   database"), and use the change in the app locally.
2. Live project: Supabase dashboard, then SQL Editor, then New query.
3. Paste the new file's contents and run it. Each file is run once.
4. **Do this before pushing code that depends on it.**

To check from a terminal that a new column landed (use your real URL and
publishable key): requesting `…/rest/v1/groups?select=<column>` with the
`apikey` header returns `200 []` if the column exists and `400` if not.

### Deploy a change

Commit and push to `main`. Vercel builds and publishes automatically, usually
within a minute or two. The Vercel dashboard shows each deploy; if one fails,
the previous version stays live.

### Add a due date to the Aircraft page

1. Run `alter table public.groups add column <name> date;` in the SQL editor.
2. Add one entry to `STATUS_FIELDS` in `src/lib/aircraft-status.ts`.
3. Push.

### Add someone to a group

An admin opens the group's **Settings** page, types who the invite is for,
picks Member or Admin, and creates the link. They send the link to the person.
The person signs up (or signs in) and enters their name; they set their own
password. The link works once and expires after 14 days; an unused one can be
cancelled from the same page.

### Change someone's role, or remove them

Settings, then Members: "Make admin" / "Make member", or "Remove". Removing
someone cancels their upcoming bookings but keeps past bookings and tech log
entries under their name. They can be invited again later. A group always
keeps at least one admin; the app will say so if you try otherwise.

### Delete someone's account and data

Removing a member from a group is a button (above). Deleting the *account*
itself is not, and it is not a one-click job. Deleting a user in
Supabase (Authentication, then Users) removes their group membership
automatically, but **the database refuses the deletion while that user still
has bookings or tech log posts**, because those rows point at them. You would
first remove those rows (or change their author) in the Table Editor, which
also rewrites the group's history. Do this only when someone asks, as promised
on the privacy page, and ask me to prepare the exact SQL first.

### Change the hero film

Put the new footage in `design/` (raw `design/film*.mov` files are not
tracked by Git, so they never get uploaded) and run
`scripts/encode-hero-video.sh design/<file>.mov`. It needs `ffmpeg`, which is
not installed on your Mac (you can fetch a temporary copy with
`npm i ffmpeg-static` and pass its path as `FFMPEG=`). The script re-encodes
iPhone HDR footage correctly, writes `public/video/hero.<fingerprint>.mp4` and
a matching poster, deletes the previous footage's files, and updates
`_components/hero-media.ts` with the new names. The fingerprint in the name is
what makes visitors see the new film at once instead of a cached old one.
Commit all of it and push. Keep the video near 3 MB. Because bright sky behind
the headline can hurt readability, check the contrast (the dark overlay in
`Hero.tsx` is currently the page's near-black at 66%). The script also applies a
gentle warm colour grade (the `GRADE` setting at the top of the script;
`GRADE=` switches it off).

### Change the contact address or privacy page

The contact address is `CONTACT_EMAIL` in
`src/app/(marketing)/_components/Footer.tsx`. The privacy page is
`src/app/(marketing)/privacy/page.tsx`. Update its "Last updated" date
whenever it changes, and change it if you add analytics, a new service that
handles user data, or new personal information.

### The test database

Blocktime has two databases: the **live** one (the Supabase project
`blocktime`, ref `trdtqhkbxssujcwmvham`, which the website uses) and a **test** one (a second,
free Supabase project, `blocktime-test`) that holds only made-up data. Your
Mac points at the test one, so trying things locally can never touch real
flights, costs or members. Only Vercel knows the live one.

**Set it up (once):**

1. In the Supabase dashboard, New project: name `blocktime-test`, region
   London, and a strong database password (save it in your password manager).
   The free plan allows two projects.
2. In the test project: Authentication, then Sign In / Providers, then Email,
   and **turn off "Confirm email"**, so you can create test accounts without
   waiting for emails. Under Authentication, then URL Configuration, set the
   Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to the
   redirect URLs.
3. Open `.env.local` on your Mac. The live values that are in it now are also
   saved in `.env.live`, so nothing is lost. Replace:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the
     test project's (Settings, then API),
   - `SITE_URL` with `http://localhost:3000`,
   - and add `TEST_DATABASE_URL=` with the test project's connection string
     (Connect, then Session pooler; put the database password in place of
     `[YOUR-PASSWORD]`).
4. Run `npm run db:migrate`. It builds the whole database in the test project
   from `supabase/migrations`, in order, and remembers what it has applied. It
   refuses to run against the live project.
5. `npm run dev`, then sign up two or three test accounts and create a test
   group (and invite the accounts to it). The demo at `/demo` is the quick way
   to see the app with data; the test project is for trying real changes.

**From then on, every database change goes through the test project first:**
add the migration file, run `npm run db:migrate` (test), try it in the app,
and only then run the same SQL on the live project (see "Run a database
change"). Email: the test project sends no notification emails, because
`.env.local` has no `RESEND_API_KEY`.

**If you ever need the live values on your Mac** (for example to look at live
data locally), they are in `.env.live`. Don't do that casually.

### Backups

**What happens:** every night at about 03:17 UTC, a GitHub job (`Daily
database backup`, in this repository's Actions tab) copies the whole live
database, **proves the copy works by restoring it into a throwaway database
and comparing it with the original** (tables, rules, permissions, row counts),
encrypts it, and stores it as a release in the private repository
`blocktime-backups`. It keeps the last 30 days plus the oldest backup of each of
the last 12 months. It only ever reads the live database. If a night's backup
fails, GitHub emails you. The same machinery is tested without any real data
whenever the backup scripts or the migrations change (`Backup self-test`).

**What is in a backup:** everything: all groups' data and the sign-in table
(emails and password hashes, so everyone can still sign in after a restore).
That is why the file is encrypted with a passphrase before it leaves the job.
**Without the passphrase a backup cannot be opened. Keep it in your password
manager.**

**Set it up (once):**

1. **The database connection.** Supabase dashboard, live project, Connect,
   **Session pooler**: copy the connection string. (GitHub's machines cannot
   use the "direct" one.) It contains `[YOUR-PASSWORD]`: that is the database
   password (Settings, then Database, "Reset database password" if you don't
   have it; resetting it doesn't affect the website). Put the real password in
   its place.
2. **A private repository.** GitHub, New repository, name `blocktime-backups`,
   **Private**, and tick "Add a README file" (a release needs a first commit).
3. **A token that can write to only that repository.** GitHub, Settings,
   Developer settings, Personal access tokens, **Fine-grained tokens**,
   Generate: resource owner you, repository access "Only select repositories"
   and choose `blocktime-backups`, permission **Contents: Read and write**,
   expiry 1 year. Put a reminder in your calendar a week before it expires: when
   it does, the nightly job starts failing (and emails you).
4. **A passphrase.** In a terminal: `openssl rand -base64 32`. Save the result
   in your password manager first.
5. **Four secrets** in the code repository (`syndicate-booking-app`): Settings,
   Secrets and variables, Actions, New repository secret:
   - `BACKUP_DATABASE_URL`: the connection string from step 1
   - `BACKUP_PASSPHRASE`: from step 4
   - `BACKUP_REPO_TOKEN`: from step 3
   - `BACKUP_REPO`: `henningstolz/blocktime-backups`
6. **First run.** Actions tab, Daily database backup, Run workflow. A green tick
   means a verified backup now sits in `blocktime-backups`, under Releases.

**Look after it:** the code repository is public, so the job's log is public;
it is written to print no data (not even row counts). GitHub switches off
scheduled jobs in a repository with no activity for 60 days, which cannot happen
while you keep pushing changes, but if you ever stop for two months, check the
Actions tab. Once a month, glance at the backups repository's Releases: there
should be one a night.

**Restore (disaster, or a practice drill).** You need `psql`, `pg_dump` and
`pg_restore` version 17 (on a Mac: `brew install postgresql@17`).

1. Download the newest `backup-….tar.enc` from the backups repository's Releases.
2. Unpack it (needs the passphrase):
   `BACKUP_PASSPHRASE='…' scripts/backup/encrypt.sh unpack backup-2026-10-08.tar.enc /tmp/restore`
3. Create a **new, empty** Supabase project (never restore into the live one;
   the script refuses a database that already has tables). Use its Session
   pooler connection string:
   `scripts/backup/restore.sh '<connection string>' /tmp/restore`
   It ends with `RESTORE VERIFIED` when the copy matches the original. Add
   `SHOW_COUNTS=1` in front to see the row counts.
4. If this is a real recovery, point the website at the new project: in Vercel,
   replace `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Production), redeploy, set the new project's Authentication, then URL
   Configuration to the live address, and add the new project's SMTP settings
   (Resend) so sign-up emails work. The notification secret
   (`notification_worker`) is part of the data and comes back with it.

**The drill (do it after big changes, or a few times a year).** It restores the
newest backup into the **test project** and checks the copy matches the live
database. It needs one more Actions secret, `TEST_DATABASE_URL` (the same
Session pooler string as in `.env.local`). Then: Actions tab, **Restore drill
(into the TEST project)**, Run workflow, and type `empty the test project`. It
empties the test project first, restores, and compares everything (tables,
security rules, who may call which function, row counts). It refuses to run
against the live project. First done 2026-10-08 (it needed three fixes that
only a real Supabase project could show: Supabase's own default-permission
entries, and its automatic grants of new functions to anonymous visitors).

Afterwards the test project holds a **copy of the real data**. Sign in locally
with your real account if you want to see that a recovery works, then empty it:

```bash
npm run db:reset-test -- --yes   # empties the test project (refuses the live one)
npm run db:migrate               # rebuilds it, empty
```

### Someone forgot their password

They use "Forgot your password?" on the sign-in page. The email comes from
`noreply@mail.blocktime.group` and must be opened in the **same browser** that
requested it (that is how Supabase keeps the link safe). If it fails, the
person sees "That reset link has expired" and can ask again. For the link to
work, `https://blocktime.group/**` must be in Supabase, Authentication, URL
Configuration, Redirect URLs. Signed-in members can change their password
from Settings. Passwords must be at least 8 characters.

### Log a flight

Tech log, then **+ Entry**: date, from and to, flight category (PV, TG or PT),
the captain, fuel in each tank, oil, and the four times (brakes off, airborne,
landed, brakes on), plus any defect. Flight time, block time and the new
airframe total are calculated. Entries can't be edited. If one is wrong, an
admin opens it, chooses **Void this entry** and gives a reason, and the pilot
enters it again correctly.

### Print a month of the flight log

Tech log, then **Monthly PDF**: choose the month and tap **Download PDF**. You
get an A4 landscape page set laid out like the paper log, with the header
(group, registration, type, month), one row per flight, and page numbers.
Voided entries are printed struck through with their reason. Columns: the
fields a pilot enters, then block and flight time in decimal hours, the
airframe total after each flight and the hours left to the next check
(against the check limit that applied when the flight was logged). Every page
has a signature line (signed, name, date). The totals are blank if the
airframe hours are not set up yet on the Aircraft page. The lower defects
section of the paper sheet is not printed.

### Set up (or correct) the airframe hours

Aircraft page, **Edit** (admins): enter "Airframe total hours (right now)" and
"Next check at (airframe hours)", for example 5870.4 and 5892.9 from the paper
sheet. From then on every flight updates the total and the hours to the next
check. Entering the total again later (for example after reconciling with the
paper log) re-calibrates it without losing logged flights.

### Set up email notifications

One-time setup so the app can send the emails members choose in Settings,
then Notifications. The code is live but sends nothing until these steps are
done (and the database change 0013 has been run).

1. **A sending key from Resend.** Resend, then API Keys, then Create API Key.
   Name it "Blocktime notifications", permission **Sending access**, domain
   `mail.blocktime.group`. Copy the key (starts with `re_`).
2. **The secrets for the sender.** In a terminal on your Mac run this; it
   prints the two secrets for Vercel and one line for Supabase (keep the
   screen private):

   ```bash
   TOKEN=$(openssl rand -hex 32); echo "NOTIFY_TOKEN=$TOKEN"; echo "CRON_SECRET=$(openssl rand -hex 24)"; echo "insert into public.notification_worker (token_hash) values ('$(printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1)');"
   ```

3. **Tell the database the secret's fingerprint.** Supabase, SQL Editor, paste
   the `insert into ...` line (only a fingerprint, not the secret) and run it.
4. **Give the server the keys.** Vercel, your project, Settings, Environment
   Variables, then **Add New** for each of `RESEND_API_KEY` (step 1),
   `NOTIFY_TOKEN` and `CRON_SECRET` (both printed in step 2). Paste only the
   value (nothing before the `=`, no quotes, no spaces), tick **Production**
   only (not Preview or Development), and switch **Sensitive** on. Leave
   `SITE_URL` and the Supabase settings as they are.
5. **Redeploy.** Vercel, Deployments, the latest one, Redeploy (new settings
   only apply to a new deployment).
6. **Test it.** Settings, Notifications, **Send me a test email**. It should
   arrive within a minute.
7. **Try the real thing.** Invite a second address of yours (a Gmail `+test`
   alias), join with it, then post in the chat as yourself: the alias's inbox
   should get an email (you never get emails about your own actions).

Do **not** put these keys on your Mac (`.env.local`): your Mac uses the test
database, and sending from there would email the test accounts for nothing (and
could email real people if you ever pointed it at live data).

### Change what members are emailed about

Members choose for themselves under Settings, then Notifications. To change
which events exist or the defaults, edit `src/lib/notifications.ts` and the
matching `notification_default()` in a new migration; the tests check the two
agree. To see what is waiting or stuck, look at `notification_outbox` in
Supabase's Table Editor (the `last_error` column says why an email failed).

### Show the demo

Share `blocktime.group/demo`, or use "Try the demo" on the homepage. Visitors
click through the whole app as "Alex", the admin of an invented group, without
signing up. Whatever they change stays in their own browser (and "Reset demo"
clears it); nothing reaches your database. It keeps working even if Supabase
is paused.

### Change what the demo shows

The invented people, bookings, chat messages, flights and aircraft dates are
in `src/lib/demo/data.ts` (names, notes, routes, defects). It is generated
relative to today, so it never goes stale. After changing a page or a database
query in the real app, run `npm run dev` and, in another terminal,
`npm run test:demo`: if the demo can no longer answer a page's questions, it
fails there with the page's name.

### Set up and run the costs

Costs are worked out for each calendar month. A member's total is their
**fixed monthly share**, plus the **hourly rate** times their block hours,
minus any **expenses** they paid for the group. There is no shared fuel pot:
fuel is paid by the group's fuel card, or by a member who is then credited.

1. **Set the group rates** (admins): Costs, then **Group rates**. Choose the
   month they apply from, the **fixed monthly share** and the **hourly rate**
   (per block hour). They apply from that month until you set new ones.
   Earlier months keep their old rates, so raising the hourly rate never
   changes a past statement. To correct a mistake, save the rates again for the
   same month: the newest entry wins.
2. **Individual rates** (admins, optional): Costs, then **Individual rates**.
   Choose the member, the month, and their own fixed share and/or hourly rate.
   A box left empty follows the group's rate; enter 0 for none (for example no
   fixed share for someone who does not own a share but pays more per hour).
   Saving with both boxes empty puts the member back on the group's rates.
   Members only ever see their own rates.
3. **Expenses** (admins): Costs, then **Expenses paid by members**. When a
   member pays for the aircraft out of their own pocket (say fuel at another
   airfield), choose who paid, the date, what it was and the amount. It is taken
   off that member's total for the month of its date. If the expenses come to
   more than their bill, the statement shows a **credit to them**. An expense
   cannot be edited: **Void this expense** with a reason and enter it again.
4. **The flights** come from the tech log. Each flight's **block time** (brakes
   off to brakes on) is charged to its captain; for a guest or instructor
   captain it is charged to the member who logged the entry.

5. **Close the month** (admins, optional): once a month is over, Costs, then
   **Close <month>**, with an optional note. This saves everyone's statement
   exactly as it stands and freezes it: later flights, new rates or new entries
   can no longer change it, and no expense can be added to (or voided in) that
   month. Pilots can still log flights in a closed month, because the tech log
   must stay complete; those flights don't change the closed figures, and you
   see a yellow "Changed since this month was closed" box listing who would now
   pay something different. To take such changes in, **Reopen this month** (with
   a reason; it is recorded) and close it again. A month without rates can't be
   closed, and neither can the current month.

Each member sees **their own statement**: the fixed share, flying (with every
flight listed), expenses they paid, and the total. Admins also see everyone's.
Use the month arrows to go back.

**PDF statements:** **Download PDF** above a statement gives an A4 PDF of it. A
closed month prints the saved, final figures and says so; an open month is marked
"Provisional". Admins also get **PDF** next to each member in the Everyone table
(to send to that member) and **Download everyone (PDF)**: a summary page with
the total to collect, then one page per member. Nothing is emailed yet; the PDFs
are for sending yourself or printing.

How the numbers are worked out: all amounts are whole pence. Each flight is
charged hours times the hourly rate that applies to the person it is charged
to, rounded half up to the penny. Anyone who was in the group at any point in a
month pays that month's full fixed share.

If a number looks wrong: check the flight log first (a voided or mistyped
flight changes the charge), then the rates and expenses listed for that month.
If the month is closed, the page shows the saved figures; the yellow box says
what has changed since.

### Reminders

Members get a booking reminder the evening before each of their bookings, and
everyone gets aircraft reminders when a check, renewal or other due date is 30 or
7 days away or overdue, and when the hours to the next check reach 10 and 5 (and
the limit). Each reminder is sent once. They go out every evening around 17:00
to 18:00 UK time (Vercel's free plan runs a job once a day at a fixed time).

- **To send them straight away** (to test, or after fixing a date): Settings,
  Notifications, **Send due reminders now** (admins). Pressing it again changes
  nothing, because each reminder is only sent once.
- **A reminder did not come:** the booking must start tomorrow (UK date), be
  confirmed and have been made more than three hours earlier; the member must
  have "Booking reminders" switched on. For aircraft reminders check the date or
  hours on the Aircraft page: the countdown only starts within 30 days (or 10
  hours). Supabase, Table Editor, `reminder_log` shows what was already sent.

### Notification emails are not arriving

1. Settings, Notifications, **Send me a test email**. If that fails, the
   server settings (step 4 above) are wrong or missing, or Resend refused.
2. If the test works but real emails don't: check the person has the event
   switched on, and remember nobody is emailed about their own action.
3. Supabase, Table Editor, `notification_outbox`: rows with a `last_error`
   show what Resend said; rows with `attempts` of 5 gave up; rows with no
   `sent_at` and a recent `created_at` are waiting for the next send.
4. Resend's free plan limits (about 100 a day, 3,000 a month) apply: its
   dashboard shows what was sent and any refusals.

### Something is down

1. **Site shows an error or is blank:** check Vercel, then Deployments, for a
   failed deploy; roll back to the previous one if needed.
2. **Everyone is signed out or sees errors loading data:** check Supabase
   isn't paused, and look at its status page.
3. **Sign-up emails don't arrive:** check Resend's logs, then the Supabase
   Auth logs. Look for a restricted or revoked key.
4. **`hello@` mail isn't arriving:** check ImprovMX's dashboard, then that its
   DNS records still exist in Vercel.
5. **Confirmation links fail:** check `SITE_URL` in Vercel and the redirect
   URLs in Supabase, Authentication, URL Configuration. They must include the
   live address.

## Local development

```bash
npm install        # once
npm run dev        # starts http://localhost:3000
npm run lint
npx tsc --noEmit
npm run test:db    # checks the database rules in a throwaway Postgres
```

You need a `.env.local` with the variables listed in
[architecture.md](architecture.md#environments-and-configuration), pointing at
the **test** project (see "The test database"). `npm run db:migrate` brings the
test project up to date with `supabase/migrations`.
