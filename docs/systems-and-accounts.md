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
| 3 | **Supabase** (project ref `trdtqhkbxssujcwmvham`, London) | The database, sign-in, and the SQL editor where migrations are run. | supabase.com/dashboard | Project keys are under Settings, then API. |
| 4 | **Resend** (EU region) | Sends email: sign-up confirmations, and mail you send as `hello@`. | resend.com | API keys: one inside Supabase's SMTP settings, one in Gmail's "send as". |
| 5 | **ImprovMX** | Forwards `hello@blocktime.group` to your personal inbox. | improvmx.com | Account login only. |
| 6 | **Gmail** (your personal account) | Receives `hello@` mail and sends as it. | gmail.com | Holds the "send as" Resend key. |
| 7 | **Domain registrar for `blocktime.group`** | Owns the domain name and renews it every year. | _Write down where you registered it_ | Account login only. |

**To fill in yourself** (I can't see these, and they are what you'd lose track
of first): which email address each account is registered under, which
registrar holds the domain and when it renews, and which plan each service is
on.

### The two Resend keys

You have two separate keys on purpose, so one can be revoked without breaking
the other.

- **Supabase's SMTP key.** Has access to all domains. Used by Supabase to send
  sign-up emails. Lives in Supabase, then Authentication, then SMTP Settings.
- **Gmail's "send as" key.** Sending-only, limited to `blocktime.group`. Lives
  in Gmail's Send mail as settings.

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
- **Backups.** On a free Supabase plan you should not rely on automatic
  backups. Before real data accumulates, either upgrade or export data
  regularly.
- **Vercel's free (Hobby) plan is for non-commercial use.** Fine for a group
  of friends. If Blocktime ever charges money, move to a paid plan.
- **Resend's free plan has daily and monthly sending limits.** Plenty for
  sign-up emails at this size.
- **Domain renewal.** Turn on auto-renew at your registrar.

## How-tos

### Run a database change (migration)

Migrations are plain SQL files in `supabase/migrations/`, numbered in order.

1. Supabase dashboard, then SQL Editor, then New query.
2. Paste the new file's contents and run it. Each file is run once.
3. **Do this before pushing code that depends on it.**

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

Run `scripts/encode-hero-video.sh <input-file> [poster-second]`. It needs
`ffmpeg`, which is not installed on your Mac (you can fetch a temporary copy
with `npm i ffmpeg-static` and pass its path as `FFMPEG=`). It writes
`public/video/hero.mp4` and `hero-poster.jpg`; commit and push them. Keep the
file near 3 MB.

### Change the contact address or privacy page

The contact address is `CONTACT_EMAIL` in
`src/app/(marketing)/_components/Footer.tsx`. The privacy page is
`src/app/(marketing)/privacy/page.tsx`. Update its "Last updated" date
whenever it changes, and change it if you add analytics, a new service that
handles user data, or new personal information.

### Separate testing from live data (recommended before inviting the others)

1. Create a second Supabase project for development.
2. Run all the migrations in it, in order.
3. Point `.env.local` on your Mac at the new project, and keep Vercel pointing
   at the real one.
4. Add `http://localhost:3000/**` to the new project's Authentication, then
   URL Configuration, redirect URLs.

### Someone forgot their password

They use "Forgot your password?" on the sign-in page. The email comes from
`noreply@mail.blocktime.group` and must be opened in the **same browser** that
requested it (that is how Supabase keeps the link safe). If it fails, the
person sees "That reset link has expired" and can ask again. For the link to
work, `https://blocktime.group/**` must be in Supabase, Authentication, URL
Configuration, Redirect URLs. Signed-in members can change their password
from Settings. Passwords must be at least 8 characters.

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

You need a `.env.local` with the three variables listed in
[architecture.md](architecture.md#environments-and-configuration). Remember
that, until you separate them, local testing writes to the live database.
