# Blocktime: architecture

How the app is put together and why. For the accounts and services behind it,
and for step-by-step "how do I…" tasks, see
[systems-and-accounts.md](systems-and-accounts.md). The original product brief
is [project-brief.md](project-brief.md).

_Last updated 5 October 2026._

## In one paragraph

Blocktime is a multi-tenant web app for small groups that share an aircraft.
One Next.js project serves both the public homepage (`/`) and the signed-in
app (`/<group>/…`). Supabase holds the database and handles sign-in. Vercel
runs the Next.js code. Everything a group stores carries a `group_id`, and the
database itself refuses to show one group's rows to another group's members.

## The big picture

```
                         blocktime.group
                               │
   Browser (phone/desktop) ────┤
                               ▼
                    ┌────────────────────┐
                    │  Vercel            │   builds & hosts the Next.js code;
                    │  Next.js 16 app    │   every push to GitHub `main`
                    └─────────┬──────────┘   deploys automatically
                              │  sign-in + data (as the signed-in user)
                              ▼
                    ┌────────────────────┐
                    │  Supabase (London) │   Postgres database, row-level
                    │  database + auth   │   security, email/password sign-in
                    └─────────┬──────────┘
                              │  sign-up confirmation emails
                              ▼
                    ┌────────────────────┐
                    │  Resend (SMTP)     │   sends as
                    │                    │   noreply@mail.blocktime.group
                    └────────────────────┘

   Someone writes to hello@blocktime.group
        → ImprovMX forwards it → your personal inbox
        → you reply from Gmail "send as" hello@ → sent through Resend

   GitHub (henningstolz/syndicate-booking-app) ── push to main ──► Vercel
```

Nothing else runs. There is no separate API server, no background jobs, no
analytics and no file storage. The app is a set of server-rendered pages plus
form actions that talk to Supabase.

## Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript | Next 16 differs from older versions: `middleware` is now `proxy`, and `<Image priority>` is `preload`. Read `node_modules/next/dist/docs/` before changing framework-level code. |
| Styling | Tailwind CSS v4 | Homepage colours are `bt-*` tokens in `src/app/globals.css`. |
| Fonts | Inter (app), Hanken Grotesk (homepage only), IBM Plex Mono (shared) | Fonts are scoped to the element they are applied to. |
| Database and sign-in | Supabase (Postgres + Auth) via `@supabase/ssr` | Region: London. |
| Hosting | Vercel | Auto-deploys from GitHub `main`. |
| Email out | Resend (SMTP for Supabase's sign-up emails and Gmail's "send as"; its web API for notification emails) | |
| Email in | ImprovMX | Forwarding only, no mailbox. |
| PDF | `pdf-lib` (npm) | Pure JavaScript, so it runs on Vercel with no font files. Uses the standard PDF fonts, so characters outside Western European text print as "?". |

## How a page request works

1. **`src/proxy.ts`** runs on nearly every request. It calls Supabase to
   refresh the sign-in session, so server code always sees a valid (or
   correctly expired) user.
2. **Pages are server components.** They create a Supabase client from the
   request's cookies (`src/lib/supabase/server.ts`) and read data **as the
   signed-in user**. There is no admin key anywhere in the app.
3. **Writes are server actions** (`actions.ts` next to each page). They check
   the input, write as the signed-in user, then `revalidatePath` so the page
   shows the change.
4. **Row-level security (RLS) is the real gatekeeper.** Even if page code had
   a bug, Postgres only returns or accepts rows the user is allowed to touch.
5. **State lives in the URL** (`?view=`, `?metric=`, `?year=`, `?start=`,
   `?month=`) using plain links. There is almost no client-side JavaScript.

Signed-out visitors to `/<group>/…` are sent to `/login`. A signed-in user
with no group lands on `/pending`, which offers "Create a group".

**Several groups.** The group name in the header becomes a menu when someone
belongs to two or more groups (`GroupSwitcher.tsx`), with a "Start another
group" entry. The group you last used is remembered in a cookie
(`bt_last_group`, holding only the group's web address) so the next sign-in
opens it; if that group is gone or the cookie is missing, the oldest group
is opened (`lib/pick-group.ts`, `lib/user-home.ts`). Visiting a group you are
not in, leaving a group, or being removed from one sends you to another of
your groups, or to `/pending` if you have none.

## Routes

| Path | What it is |
| --- | --- |
| `/` | Public homepage (hero film, board illustration, features, privacy teaser, footer) |
| `/privacy` | Privacy page |
| `/demo` and `/demo/...` | The demo group: the real app on invented data, no sign-up, nothing saved to the database (see "The demo" below). `/demo/reset` clears a visitor's own demo changes |
| `/login` | Sign in / sign up (email and password) |
| `/auth/callback` | Receives the `?code=` from a confirmation or password-reset email and turns it into a session. Only follows a plain site path in `?next=` (see `src/lib/safe-next-path.ts`) |
| `/forgot-password` | Asks for an email and sends a reset link. Always answers the same, whether or not the address has an account |
| `/reset-password` | Choose a new password. Reached from the reset email, or from "Change password" in Settings. Signs out every other device |
| `/pending` | Signed in but not in any group yet |
| `/groups/new` | Create a group (you become its admin) |
| `/join/<inviteId>` | Accept an invitation link |
| `/<group>` | Dashboard: aircraft info, next booking, warning banner if something is due |
| `/<group>/calendar` | Booking calendar: List and Month views, block-booking presets |
| `/<group>/chat` | The group chat: a shared message feed where anyone posts to everyone (not only defects). Old URLs `/squawks`, `/board` and `/tech-log?view=notes` redirect here |
| `/<group>/tech-log` | The flight log: one entry per flight added with "+ Entry", with calculated flight/block time and running airframe hours. "Monthly PDF" picks a month and downloads it |
| `/<group>/tech-log/pdf?month=YYYY-MM` | The monthly flight log as an A4 landscape PDF (route handler, members only). Built by `src/lib/flight-log-pdf.ts` with the `pdf-lib` library |
| `/<group>/costs` | Hours and costs, a month at a time (`?month=YYYY-MM`): your statement with the flights behind it, the month's group totals; for admins everyone's statements, the group rates and members' own rates (with history) and the expenses members paid |
| `/<group>/reports` | Upcoming bookings, and "Bookings per member" donut chart |
| `/<group>/aircraft` | Renewal and check due dates; admins can edit |
| `/<group>/members` | Read-only member list |
| `/<group>/settings` | **General** tab: your name and "leave group" (everyone); admins also change roles, remove members, create and cancel invite links, edit the group's details. **Notifications** tab (`?tab=notifications`): choose which events email you, and send yourself a test email |
| `/api/cron/notify` | Called each morning by Vercel (needs the `CRON_SECRET` setting) to send any email left in the queue |
| `/api/cron/reminders` | Called each evening by Vercel (about 17:00-18:00 UK): queues the reminders that are due and sends them |

The signed-in routes sit in the `(app)/[groupSlug]` folder; the public ones in
`(marketing)`. Folder names in parentheses don't appear in URLs.

## Data model

All tables are in the `public` schema, all have RLS switched on, and every one
is scoped to a group.

| Table | Holds | Notes |
| --- | --- | --- |
| `groups` | One row per flying group: slug, name, registration, type, base, plus the aircraft due dates | Due-date columns are listed once in `STATUS_FIELDS` (`src/lib/aircraft-status.ts`). |
| `group_members` | Who belongs to which group, role (`admin` or `member`), display name, and `removed_at` | Links to Supabase's `auth.users`. A removed member keeps their row (so history keeps their name and colour) but `removed_at` is set and the access rules treat them as outside the group. |
| `bookings` | Start, end, note, status (`confirmed` or `cancelled`), who booked | A database rule makes overlapping confirmed bookings in one group impossible. Cancelling only changes the status; nothing is deleted. A multi-day booking is one row. |
| `squawks` | The chat's messages: author, message, time | The table keeps its original name; only the screens say "Chat". |
| `flight_entries` | The flight log: date, from/to, category (PV/TG/PT), captain, fuel in each tank, oil, the four clock times, defects, who entered it | **Never edited or deleted** (like paper): an admin *voids* a wrong entry with a reason, and it stops counting. Block and flight minutes and their decimal hours are generated columns, so every screen agrees. Each entry also remembers the check limit that applied when it was logged (`check_limit_hours`), so "hours to check" stays right after a check resets the limit. A database rule makes overlapping flights impossible. |
| `cost_rates` | The fixed monthly share and the hourly rate (whole pence), each valid from a month. A row with no `user_id` is the group's default; a row with a `user_id` is that member's own (an empty part follows the group's, 0 is a real zero) | Append-only: a new row for a month replaces older ones from then on, old rows stay as history. A statement uses the rates in force for ITS month. Members read the group's rows and their own, never other members'. |
| `cost_expenses` | Something a member paid for the aircraft out of their own pocket: who paid, date, description, amount (whole pence) | Admins and the payer read it (RLS); voided with a reason, never edited. Credited on the payer's statement for the month of its date. (The old `cost_items` table of pooled fuel is no longer used and is removed by a later clean-up.) |
| `notification_preferences` | Which events a member wants emailed, per group (only explicit choices; the rest follow the defaults in `notification_default()`) | Defaults: bookings, cancellations, chat and defects on; flights logged off. The app's list (`src/lib/notifications.ts`) is checked against the database's in the tests. |
| `notification_outbox` | The queue of emails to send: recipient, event, details, attempts, sent time | Not readable through the API at all. Sent rows are deleted after 30 days, unsent after a week. |
| `reminder_log` | Which reminders have already been sent (`booking:<id>`, `aircraft:<item>:<due date>:<stage>`) | Not readable through the API. Booking entries are cleared after 30 days; aircraft ones are kept, which is what stops a reminder repeating. |
| `notification_worker` | The hash of the sender's secret | Not readable through the API. |
| `invites` | Invite links: group, role, a name label, who made it, expiry (14 days), cancelled-at, who used it and when | One use per link. Not tied to an email address: whoever holds the link can use it once. |

Postgres functions marked `SECURITY DEFINER` run with the table owner's
rights, so a policy can look at rows the user can't see. They exist to avoid
the traps described below.

- Access checks: `is_group_member`, `is_group_admin` (both ignore removed
  members), `has_valid_invite`, `group_has_no_members`.
- Invites: `get_invite_info` (public, so the join page can show the group's
  name), `accept_invite` (validate, add or re-add the member, mark used, all
  in one step), `revoke_invite`. `mark_invite_used` is the old two-step
  helper, no longer called.
- Membership changes: `set_member_role`, `remove_member`, `leave_group`,
  `set_my_display_name`. They return a result such as `ok` or `last_admin`
  instead of failing. **A group can never be left without an admin**: the
  database refuses to demote, remove or let leave the last one. Removing or
  leaving also cancels that person's *future* bookings.

- Costs: `set_cost_rate`, `set_member_cost_rate`, `add_cost_expense` and `void_cost_expense` (admin only), and `cost_statement(group, month)`, which returns one month as JSON for the caller. The rule: each member pays the **fixed monthly share** (anyone in the group at any point in the month) plus the **hourly rate** for the block hours charged to them, minus the **expenses** they paid for the group; the share and rate are the member's own if an admin set them, otherwise the group's. A flight is charged to its captain, or for a guest captain to the member who logged it, at that person's hourly rate. Everything is whole pence; each flight's charge is rounded half up. A total below zero means the group owes the member money. `src/lib/costs.ts` holds an identical twin of the calculation, used by the demo; a test compares it with the database on hundreds of random months, with member rates and expenses.
- Notifications: triggers on bookings, chat messages and flights queue one email per member who wants it (never the person who did it, never a removed member, at most 20 an hour per person; a failure to queue never blocks the booking, post or flight). `set_notification_preferences` saves a member's choices. `claim_notifications`, `mark_notification_sent` and `mark_notification_failed` are how the server works through the queue; they only answer to the sender's secret.
- Flight log: `add_flight_entry` (validates everything and returns a result
  such as `ok`, `overlap`, `times_order`), `void_flight_entry` (admin),
  `set_airframe_hours` (admin: "the total is X right now, the next check is at
  Y"), `minutes_to_deci` (the paper table's rounding), and the internal
  `recalc_airframe_hours`. **Airframe total hours = baseline + the flight time
  of every non-voided entry**; the group keeps a cached total and the hours to
  the next check (= check limit minus total), recalculated on every change.
  Flight time (airborne to landed) drives the airframe hours; block time
  (brakes off to brakes on) is stored for the cost sharing to come.

These rules are tested in `supabase/tests/` (`npm run test:db`), which applies
every migration to a throwaway in-memory Postgres; the pure helpers in
`src/lib` (time maths, redirects) are tested by `npm run test:unit`;
`npm test` runs both. `npm run test:demo` crawls every demo page on a running dev server. Run them after changing a migration or those helpers.

The database change history is the numbered files in `supabase/migrations/`
(0001 to 0016).

## Code map

```
src/
  proxy.ts                    session refresh on every request
  app/
    layout.tsx                root layout, fonts, site metadata
    (marketing)/              homepage and /privacy, with its own layout (Hanken font)
      _components/            Hero, HeroFilm, BoardSection, Features, Footer, …
    (app)/[groupSlug]/        the signed-in app: layout + AppShell (nav), one folder per page
    login/  join/  groups/  pending/  auth/callback/
  lib/
    supabase/                 server, browser and proxy Supabase clients
    groups.ts                 getGroupBySlug (select list built from STATUS_FIELDS)
    aircraft-status.ts        the due-date fields and their overdue/due-soon logic
    datetime.ts               all UK-time handling (see below)
    flight-times.ts           flight/block time and decimal-hour maths (also used live in the form), month helpers
    flight-log-pdf.ts         the monthly PDF, drawn like the paper log (self-contained, takes ready-made text)
    notifications.ts          the events a member can be emailed about, with the defaults (shared with the tests)
    notify/                   the notification emails: wording (email.ts), the send loop (send-core.ts), Resend and the queue (send.ts), send-after-the-reply (flush.ts)
    costs.ts                  money formatting and parsing, and the statement calculation (the database's twin, used by the demo and tested against it)
    flight-totals.ts          running airframe totals and hours to check, used by the PDF (pure, tested)
    demo/                     the demo group: invented data, stand-in database client, the visitor's cookie (see "The demo")
    member-colors.ts          the colour palette for members
    booking-durations.ts, slugify.ts
public/video/                 the hero film and its poster (fingerprinted file names)
scripts/encode-hero-video.sh  turns raw footage into the hero film
supabase/migrations/          the database history, run by hand
design/                       homepage design reference (film.mov is not tracked)
docs/                         this documentation and the product brief
```

## Rules worth knowing before you change things

These each cost a debugging round once.

1. **UK time.** Servers run in UTC. Never build a date from user-typed times
   with `new Date(string)`. Use `londonWallTimeToUtc`, and step through days
   with `addLondonCalendarDays` (a fixed 24 hours goes wrong on the days the
   clocks change). All helpers are in `src/lib/datetime.ts`.
2. **RLS pitfalls.**
   - A subquery against an RLS-protected table inside a policy is itself
     filtered by RLS, which silently gives wrong answers (one was a real
     security hole). Use a `SECURITY DEFINER` function instead.
   - `insert … returning` (supabase-js `.select()` after `.insert()`) must also
     pass the SELECT policy. When the user can't see the row yet, generate the
     id in code and skip `.select()`.
   - If a write mysteriously changes zero rows, move it into a
     `SECURITY DEFINER` function rather than debugging for hours.
3. **1000-row limit.** Supabase returns at most 1000 rows per response and
   does not warn. Reads that need everything must page (see
   `reports/distribution.ts`).
4. **Adding a due date to the Aircraft page** is one entry in `STATUS_FIELDS`
   plus one `alter table groups add column`. **Run the migration before
   pushing the code**, because every group page selects those columns and
   would otherwise fail to load.
5. **Names.** The feature is "Tech log" everywhere you can see it. The table,
   the table is still called `squawks`. That is
   deliberate; renaming them would need a migration and gains nothing.
6. **SVG `<title>`** in React 19 must be one string (use a template literal).
7. **Charts** are server-rendered SVG with no chart library.

## Environments and configuration

Three settings drive the app. They are read from environment variables, and no
secrets are committed to Git.

| Variable | Meaning | Where it's set |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Address of the Supabase project | `.env.local` (your Mac) and Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase's public "publishable" key. Safe to expose; RLS protects the data | `.env.local` and Vercel |
| `SITE_URL` | The site's own address, used in sign-up email links and notification emails | `.env.local` and Vercel (Production and Preview) |
| `RESEND_API_KEY` | A Resend key that may only send, for the notification emails | Vercel only (not on your Mac) |
| `NOTIFY_TOKEN` | The long random secret the server uses to claim queued emails; its hash is in `notification_worker` | Vercel only |
| `CRON_SECRET` | Lets Vercel's daily job call `/api/cron/notify` | Vercel only |
| `NOTIFY_FROM` | Optional sender, default `Blocktime <notifications@mail.blocktime.group>` | Vercel only |

`.env.local.example` shows the shape without values.

**Important: development and production share one Supabase database.** When
you test on your Mac, you write to the real data. This was a deliberate,
temporary choice; separate it before other members rely on real data (see the
runbook).

## Email

| Direction | Path |
| --- | --- |
| App → member (sign-up confirmation, password reset) | Supabase Auth → Resend SMTP → `noreply@mail.blocktime.group` |
| Public → you | `hello@blocktime.group` → ImprovMX forwards → your personal inbox |
| You → public | Gmail "Send mail as" `hello@blocktime.group` → `smtp.resend.com`, using a separate sending-only key |

Group invitations are **not emailed**: an admin copies a link and sends it
themselves.

## Email notifications

How an email gets from an action to an inbox:

1. Someone books, cancels, posts in the chat or logs a flight. A database
   trigger writes one row per member who wants that event into
   `notification_outbox` (in the same step as the action itself).
2. The server action finishes and replies, then (using Next.js `after`) calls
   `flushNotifications()` (`src/lib/notify/send.ts`). It claims waiting rows
   from the database with the sender's secret, writes each email
   (`src/lib/notify/email.ts`; everything a member typed is escaped), sends it
   through Resend, and reports sent or failed.
3. A failed email stays queued and is tried again by the next action and by the
   daily job (`vercel.json` calls `/api/cron/notify`). It is tried at most five
   times and never after a day.

**Reminders** work the same way but start from a timer. Each evening
`/api/cron/reminders` calls `queue_reminders()` in the database (with the
sender's secret), which queues:

- a **booking reminder** to the person who made each booking that starts
  tomorrow (UK date, so the clocks changing cannot move it; not for bookings
  made in the last three hours, cancelled ones, or removed members);
- an **aircraft reminder** to every member who wants it, when a due date
  (annual, insurance, next check, life raft, life vests, fire extinguisher)
  reaches 30 days, 7 days or is overdue, or the hours to the next check reach
  10, 5 or the limit. Items that fall due the same day share one email.

`reminder_log` makes each reminder fire once; the aircraft entries include the
due date (or the check's hours limit), so a renewal or a completed check starts
a fresh countdown. Admins also have "Send due reminders now" on the
Notifications tab, which runs the same job for their group. Vercel's free plan
runs a daily job once a day at a fixed time, so the "evening before" is one time
for everyone, and the plan allows two daily jobs (the morning retry and the
evening reminders use both).

Why the sender needs a secret rather than a database master key: reading other
members' email addresses is something the app deliberately cannot do as a
normal user. The secret opens only the queue (claim and mark), so if it ever
leaked, the worst case is someone reading or suppressing queued emails, not
reaching the data. The demo never queues or sends anything.

Sending email needs Resend's web API: the free plan allows about 100 emails a
day and 3,000 a month (check your plan), shared with the sign-up emails.

## DNS (all records are managed in Vercel)

`blocktime.group` uses Vercel's nameservers (`ns1/ns2.vercel-dns.com`), so every
record is in one place: Vercel → Domains → blocktime.group.

| Purpose | Where in DNS |
| --- | --- |
| The website | Root and `www` (Vercel sets these; `www` redirects to the root) |
| Receiving `hello@` | MX and SPF records on the root, pointing at ImprovMX |
| Sending from `mail.blocktime.group` | Records Resend created for that subdomain |
| Sending as `hello@blocktime.group` | Records Resend created for the root domain (a DKIM key, plus MX/SPF on a `send` subdomain) |

Don't delete records you don't recognise. Each group above is needed for
something to keep working.

## The demo

The homepage's "Try the demo" button opens `/demo`: the **real app** (same
pages, same components) running on an invented group, "Demo Flying Group", with
made-up members, bookings, chat messages, flights and aircraft dates. No
sign-up, and **it never touches the database**, so it also works while
Supabase is paused or down, and cannot be filled with junk by bots.

How it works:

- **Switched on by the address alone.** `src/proxy.ts` sets an internal header
  for requests whose path starts with `/demo` (and removes any copy a visitor
  sends), then skips the database session. `createClient()` in
  `src/lib/supabase/server.ts` sees the header and returns a stand-in client
  instead of the real one. A real group's address can never run on demo data
  and vice versa. The web address `demo` (and the site's own page names) are
  reserved, so no real group can take them (`src/lib/slugify.ts`).
- **The stand-in client** (`src/lib/demo/engine.ts`) answers the questions the
  pages ask (filters, ordering, paging, the one join the app uses) from the
  invented data (`src/lib/demo/data.ts`), generated relative to today from a
  fixed seed, so it always looks current and identical. It asks the same
  database rules as the real one: overlapping bookings and flights are
  refused, flights are validated, totals and hours to the next check are
  recalculated, a voided flight stops counting.
- **A visitor's own changes** (a booking, a chat message, a logged flight, a
  void or cancellation) are kept in a small cookie (`bt_demo`, sent only to
  `/demo`, expires after a day, room for about ten changes) and laid over the
  fixed data. After that the demo says to choose "Reset demo". Settings and
  aircraft edits are not saved; they say so.
- **The visitor is "Alex", the demo's admin**, so every page is shown as an
  admin sees it. A banner says it is a demo and offers Reset demo and Create
  your group.

**Rule for future work:** the demo only understands the queries the app makes
today. If you add a page or a new kind of query, the demo stops with a clear
error instead of guessing. Run `npm run test:demo` (with `npm run dev` going):
it visits every demo page. New columns also need adding to
`TABLE_COLUMNS` and the data in `src/lib/demo/data.ts`; new write actions
either work in the demo (see `engine.ts`) or are blocked there the way
`settings/actions.ts` does.

## Not built yet

- Structured defects (open/resolved, rectification, engineer sign-off): defects are free text on a flight entry for now.
- On the PDF: the lower defects/rectification/engineer section of the paper sheet (not printed).
- Costs: a PDF or emailed statement per member, tracking who has paid, charging a pilot extra for something specific (landing fees by flight), pro-rata fixed shares for part months, closing a month so it can never change.
- Email notifications for bookings, cancellations and tech log posts.
- A daily summary email instead of one email per event.
- Pilots' personal currency reminders (rating, medical, licence, 90-day currency): needs each pilot's own dates stored.
- Self-service account deletion (done by hand in Supabase today). Members can
  leave a group, but their login stays.
- Separate development and production databases.
- An installable (PWA) version for phones.
- Colour palette retune for red-green colour blindness (rose and lime are too
  close).
