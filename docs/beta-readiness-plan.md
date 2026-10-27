# Blocktime: beta-readiness plan (for Claude Code)

Purpose: prepare the app and database so that other flying groups can join in
stages (free beta first, paid later) without rebuilding anything. No billing
page or payment workflow is built yet. Everything below prepares the ground.

Read this whole file, then start in Plan Mode and give me a short plan for
Phase 0 before changing anything. Work one phase per session where possible
(my usage allowance is limited), commit in small steps on a branch, and check
each phase on a Vercel preview and the TEST database before anything touches live.

## Context

- App: blocktime.group, a booking, tech log and cost-sharing tool for shared
  aircraft ("flying groups"). A group is the central object: one aircraft, its
  members, and everything attached (bookings, tech log, costs).
- Stack, as far as I know: Vercel (hosting), Supabase (auth + Postgres, separate
  TEST and LIVE projects, regular backups), Resend (email). Inspect the repo
  and adapt this plan to what is actually there. Where the plan and the repo
  disagree, tell me instead of guessing.
- Security and group data isolation are the top priority. Every group's data is
  private to that group. Keep every new table inside the same isolation model
  (row-level security, group-scoped).
- Look and wording: keep the existing UI style. British English. Plain, short text.
- Related file: BACKLOG.md (feature ideas). This plan does not change it.

## Goal and sequence

1. **Now:** finish the parallel run in our own group, with a safety net behind it
   (restore drill, error monitoring, uptime alerts).
2. **Friendly groups (2 or 3, free):** basic terms and privacy, support contact,
   data export, a way to send feedback.
3. **Paid beta, UK only, later:** manual invoices first. The platform must already
   be able to record each group's plan, discount, trial and paid-until dates.
4. **Self-serve billing (Stripe), much later.** Out of scope here.

## Decisions (defaults, so you can proceed; I will override if needed)

- Plan keys: `founding`, `standard`, `complimentary`. Plan definitions live in one
  code file (name, member and aircraft limits, `null` = unlimited), not scattered.
- All existing groups become `founding`, cohort `founding-2026`, billing status `none`.
  I will set our own group to `complimentary` myself through the admin page.
- New groups default to `founding` until a cut-off date is set in platform settings.
- Billing enforcement is OFF (kill switch in platform settings). The feature check
  always allows everything while it is off.
- Support address: `support@blocktime.group` (I will create the mailbox).
- Error monitoring: Sentry (free tier). Uptime monitor: UptimeRobot or Better Stack
  (free tier). Propose an alternative if the repo or hosting makes one clearly better.
- The platform admin may see group metadata (name, aircraft count, member count,
  group admin name and email, plan fields, last activity), but not bookings, tech
  log or cost content.

## Explicitly out of scope

Stripe or any payment provider, pricing page, checkout, invoices, trial or
payment emails, turning enforcement on, multi-currency, translations, native apps,
SEO work. Do not build these. Leaving nullable columns for later is fine (below).

---

## Phase 0: safety net (can run in parallel; some steps are mine)

- [ ] **Health endpoint:** `/api/health` returns 200 and `{ ok: true }` if the app
      can reach the database; no secrets, no version details, no data.
- [ ] **Uptime monitor:** I set up the monitor account; you tell me exactly what
      URL, interval (5 minutes) and alert email to enter.
- [ ] **Error monitoring:** add Sentry for the server and the browser. Scrub personal
      data (emails, names, request bodies). Tell me which environment variables I
      must add in Vercel (never put keys in the repo or in chat).
- [ ] **Restore drill:** write `docs/runbook-restore.md` with the exact steps to restore
      the latest LIVE backup into a scratch project, how to verify it (row counts per
      table, a sample booking and tech log entry), and how long it took. I do the
      dashboard steps; you prepare a verification script or SQL checklist.
- [ ] **Migrations discipline:** confirm all schema changes live as SQL migration
      files in the repo, applied to TEST first, then LIVE after a backup check.
      Document this in `docs/runbook-migrations.md` (short).

**Done when:** a deliberately broken page shows up in Sentry; stopping the health
endpoint triggers an alert email; the restore drill has been done once and timed.

---

## Phase A: database foundations (TEST first)

All tables in the `public` schema with row-level security ON. Write migrations,
then automated tests for the policies (see Tests).

### Tables

**`platform_admins`**
- `user_id` (PK, references auth users), `created_at`
- Not readable or writable by normal clients. Only checked via a
  `SECURITY DEFINER` function `is_platform_admin()`. Add me with a one-off SQL
  statement that I run myself; document it in the migration comments.

**`group_plans`** (exactly one row per group)
- `group_id` (PK, references groups)
- `plan` (text, check in the plan keys), default from platform settings
- `billing_status` (check in `none`, `trial`, `active`, `past_due`, `cancelled`), default `none`
- `cohort` (text), e.g. `founding-2026`
- `trial_ends_at` (timestamptz, nullable)
- `paid_until` (date, nullable): for manual invoicing
- `price_locked_until` (date, nullable)
- `discount_percent` (integer 0 to 100, nullable)
- `billing_reference` (text, nullable): manual invoice number or note
- `stripe_customer_id`, `stripe_subscription_id` (text, nullable, unused for now)
- `created_at`, `updated_at`, `updated_by`
- A trigger creates the default row whenever a group is created, so a group
  never exists without one. Application code must still fall back safely
  (treat a missing row as "allow everything").
- Group admins of that group may SELECT their own row. Nobody writes from the
  client. Writes happen only through the admin functions below.

**`plan_events`** (append-only history)
- `id`, `group_id` (nullable, for platform-level changes), `actor_id`, `created_at`
- `event_type` (`group_created`, `plan_changed`, `setting_changed`)
- `old_values` (jsonb), `new_values` (jsonb), `reason` (text, required for manual changes)
- No UPDATE or DELETE possible for anyone (no policies, plus a trigger that raises).
- Readable by platform admins only.

**`platform_settings`** (key/value)
- Keys: `billing_enforcement_enabled` (false), `default_plan_new_groups` (`founding`),
  `default_cohort_new_groups` (`founding-2026`), `paid_beta_cutoff` (null),
  `grace_period_days` (14).
- Readable and writable only through the admin functions; the server-side feature
  check reads them through a `SECURITY DEFINER` function.

**`terms_acceptances`**
- `id`, `user_id`, `group_id` (nullable), `document` (`terms` or `privacy`),
  `version` (text), `accepted_at`.
- A user may INSERT and SELECT their own rows; platform admins may SELECT all.
  Do not store IP addresses.

### Functions (SECURITY DEFINER, with a fixed `search_path`)

- `is_platform_admin()`: true only for rows in `platform_admins`.
- `admin_list_groups()`: returns group metadata only (see the admin page).
- `admin_update_group_plan(group_id, changes jsonb, reason text)`: validates, updates
  `group_plans` and inserts a `plan_events` row in ONE transaction. `reason` is required.
- `admin_update_setting(key, value, reason)`: same pattern.
- Every admin function checks `is_platform_admin()` AND that the session is MFA-verified
  (the JWT `aal` claim is `aal2`). Anyone else gets a generic "not found or not allowed".

### Backfill

Insert a `group_plans` row for every existing group: `founding`, cohort
`founding-2026`, status `none`, and a `plan_events` row (`group_created`,
reason "backfill"). Check the row count equals the group count.

### Tests (automated; run against TEST)

- A user in group A cannot read group B's plan row.
- A group admin can read their own plan row but cannot write it, by any route.
- A normal user cannot call any `admin_*` function or read `platform_admins`,
  `plan_events` or `platform_settings`.
- A platform admin without MFA is rejected; with MFA, allowed.
- `plan_events` rows cannot be updated or deleted, even by a platform admin.
- Creating a group creates exactly one `group_plans` row.

**Done when:** migrations applied to TEST, all tests pass, backfill verified. Then
I confirm a fresh LIVE backup and you give me the exact steps to apply to LIVE.

---

## Phase B: central feature check (no behaviour change)

- [ ] One module, for example `lib/entitlements`, with:
  - `getEntitlements(groupId)` returns `{ mode: 'full' | 'read_only', reasons, limits }`
  - `assertCanWrite(groupId)` for server-side mutations
  - a pure function `computeMode(plan, billingStatus, dates, settings, now)`, unit-tested
- [ ] While `billing_enforcement_enabled` is false, `mode` is always `full`.
- [ ] Wire `assertCanWrite` into the main WRITE paths only: create booking, add tech log
      entry, add cost entry, invite member, create aircraft. Reads, login, data export
      and cancellation of the group's own existing bookings are NEVER blocked.
- [ ] Unit tests for the future rules, run with enforcement ON in tests only:
      trial ended and not paid, then read-only after the grace period; `paid_until` in the
      past, then read-only after the grace period; `complimentary` and `founding`
      with a valid price lock never blocked; limits (`null` = unlimited).
- [ ] Document the module in a short `docs/entitlements.md`.

**Done when:** the existing test suite still passes, the new tests pass, and the
app behaves exactly as before with enforcement off.

---

## Phase C: platform admin page

A page for me only, separate from the group admin role.

- [ ] Route such as `/platform-admin`. Server-side guard: platform admin + MFA verified.
      Anyone else gets a plain 404 (not 403). Add a link to it nowhere in the normal UI.
- [ ] I must enrol an authenticator app (Supabase MFA) on my own account; tell me how.
- [ ] **Summary strip:** counts of groups by plan; trials ending in the next 30 days;
      `paid_until` expiring in the next 30 days.
- [ ] **Groups table:** name, aircraft count, member count, group admin name and email,
      plan, billing status, cohort, created date, last activity (latest booking or tech
      log timestamp), trial end, paid until. Search, sort, filter by plan and status.
- [ ] **Group detail:** edit all `group_plans` fields. Saving requires a reason (short
      text). Uses `admin_update_group_plan`. Shows the history timeline from `plan_events`.
- [ ] **Platform settings panel:** the five settings. Turning `billing_enforcement_enabled`
      ON needs an explicit confirmation step that states what will happen. Uses
      `admin_update_setting`.
- [ ] **Privacy:** never show bookings, tech log or cost content, or member emails other
      than the group admins'. All data comes through the admin functions, not direct
      table reads.
- [ ] Use the service-role key nowhere in client code. If a server-side client with
      elevated rights is needed, keep it server-only and tell me why.
- [ ] Style consistent with the app; responsive enough to use on a phone.

**Done when:** I can open the page with MFA, change a group's plan with a reason, see
the history entry, and a second normal account gets a 404.

---

## Phase D: what groups see (friendly-group readiness)

- [ ] **Plan card (read-only)** in group settings, visible to group admins: plan name,
      a plain sentence such as "Founding group: free during the beta", price lock end date
      if set. No buttons, no payment.
- [ ] **Terms and privacy pages:** `/terms` and `/privacy`, versioned (store the version
      string in one place). Write a first draft from the outline below, mark every
      unverified statement with `[REVIEW]`, and show me the text before it goes live.
      I will have it reviewed.
- [ ] **Acceptance:** a required checkbox at sign-up and at group creation, saved in
      `terms_acceptances` (user, group if any, document, version, time). If the version later
      changes, ask for re-acceptance at next login (simple blocking screen; keep it small).
- [ ] **Support and feedback:** a "Help and feedback" link in the app footer and menu that
      opens an email to `support@blocktime.group` with a prefilled subject (no new table).
- [ ] **Group data export:** a button for group admins that downloads a ZIP of CSV files
      (members, bookings, tech log, costs, aircraft). Server-side, group admin only,
      group-scoped, rate-limited, and logged (use the existing audit mechanism if there is
      one, otherwise a tiny `export_log` table with group, user and time).
- [ ] **Deletion:** no self-service yet. Document the manual process (request by email,
      export first, then deletion by me through a documented SQL routine) and mention
      it in the privacy page.

### Outline for the terms and privacy drafts

Terms (short, plain English): who runs the service (company name and address
placeholders for me to fill); what Blocktime is (a scheduling and record-keeping
convenience, not an authoritative source for flight planning, airworthiness or
maintenance status); free during the beta, with at least 60 days' notice before any
charge; best-effort support, no guaranteed uptime; users' responsibility for
accurate data; data export available at any time; limits on liability (mark for
solicitor review); changes to terms and how they are notified; contact.

Privacy: what is stored (account email and name, group membership, bookings, tech
log, costs); why; who processes it (Supabase, Vercel, Resend; list the regions if known);
retention and deletion; the controller and processor split (I am likely controller
for account data and processor for group content; mark for review); user rights and
how to exercise them; cookies (essential only, if that is true); contact.

**Done when:** a brand-new test group can sign up, accept the terms, see its plan card,
export its data, and reach the support email link, with nothing visible to other groups.

---

## Working rules for this project

- Plan Mode first for each phase. Tell me about choices that touch existing data.
- Never put secrets in the repo, in commit messages or in chat. List environment
  variables I must add, and where.
- Apply migrations to TEST, run tests, and only then give me LIVE steps. Always after
  a backup check.
- Small commits, one preview deployment per phase, short summary at the end of each
  phase: what changed, what I must do by hand, what to test.
- Do not change existing booking, tech log or cost behaviour unless this plan says so.
- If something here looks unsafe or unnecessary after reading the code, say so.

## My manual steps (collected)

- Create the `support@blocktime.group` mailbox or forwarding.
- Create Sentry and uptime-monitor accounts and add the environment variables.
- Do the restore drill dashboard steps; confirm the backup before LIVE migrations.
- Add myself to `platform_admins`; enrol MFA.
- Fill in the company details in the legal drafts; get them reviewed.
- Set our own group to `complimentary` in the admin page.

## Kick-off prompt (paste into Claude Code)

> Read `beta-readiness-plan.md` in full. Start in Plan Mode. Inspect the repo and the
> current database schema, then give me a short plan for Phase 0 and list anything in
> the file that does not match what you find. Do not change anything yet.
