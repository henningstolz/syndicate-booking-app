# Syndicate booking app — project brief

## What this is
A modern replacement for aircraftbooking.co.uk, currently used by a 4-person
PA28R Arrow syndicate (G-BBFD) based at White Waltham (EGLM). Starting as a
tool for this syndicate, but deliberately architected from day one to host
other, unrelated syndicates later — so every design decision below assumes
more than one group will eventually exist, even though only one does now.

## Who it's for initially
- Syndicate members: Julian, Nik, Clive, Kelvin (plus Henning, taking on the
  admin/build side)
- Aircraft: PA28R Arrow II, registration G-BBFD, based EGLM (White Waltham)
- Known real pain point to carry over: a recurring "NO ADS-B" transponder
  fault — power-cycling is the current workaround. Useful as real seed data
  for the squawk log rather than inventing fake examples.

## Core concept: groups
"Group" is the central object. A group = one aircraft + its members +
everything that hangs off it (bookings, squawks, later cost tracking).
Henning's own syndicate is the first group; the design should make adding a
second, unrelated group (a friend's syndicate) a config-level change, not a
rebuild.

**Non-negotiable from the start:** every table carries a `group_id`, and
every read/write is scoped by "does this logged-in user belong to this
group" — enforced at the database level via Supabase row-level security, not
just trusted to application code. This was flagged explicitly as the top
priority: cheap to build in now, painful to retrofit once a second group's
data is in the same system.

## Decided stack
- **Auth + database: Supabase.** Email + password login, done properly
  (Supabase handles hashing, sessions, email verification, password reset —
  none of that gets hand-rolled). Row-level security enforces group
  isolation.
- **Hosting: Vercel or Netlify** (not SiteGround — that's fine for the
  HSBI-style static/WordPress site but not suited to a JS app needing
  git-push deploys and securely held environment variables).
- **Homepage + app in the same project** — homepage at `/`, app behind login
  at `/app` or similar. No need for a separate landing-page host.
- **Domain:** optional/cosmetic, can point a real domain at Vercel/Netlify
  later; not required to start.

## Core data model (starting point)
- `users` (via Supabase auth)
- `groups` (one row per syndicate; holds aircraft info)
- `group_members` (user ↔ group, with a role: admin vs member — Henning as
  admin was explicitly wanted given he's taking over admin duties)
- `bookings` (group_id, member, aircraft, start/end time, note)
- `squawks` (group_id, title, status: open/resolved, note)

Keep records rather than deleting them (mark cancelled/resolved instead of
removing) — an audit trail was flagged as cheap to build in now, expensive
to reconstruct later if a booking dispute ever comes up.

## Feature set (from brainstorm, roughly in build order)
1. **MVP** — login, one group (this syndicate) pre-seeded, live shared
   booking calendar + squawk log (real data, not local-only storage)
2. **Group creation flow** — turn the hardcoded group into a real
   create-a-group + invite-members screen
3. **Second group onboarding** — invite an actual friend's syndicate; this is
   the real test that data isolation works, not just an assumption
4. **Feature layer** — cost/hours tracking, notifications (email on
   booking/cancellation/squawk logged), currency reminders (IR(R) etc.),
   simple invoicing view
5. **Decide what kind of thing this is** — stays a free favour between GA
   friends, or grows into something with light cost-recovery and a bit more
   formality (terms of use, liability disclaimer that it's a scheduling
   convenience, not authoritative for flight planning)

## Other things flagged as worth getting right early, not deferring
- Permissions: admin vs member distinction inside a group
- Audit trail: who booked/cancelled/logged what, and when
- Basic privacy note once other people's data is involved (UK GDPR — nothing
  elaborate needed, just deliberate)
- Backups / what happens if Henning is unreachable and someone's locked out
  (fine to leave minimal at MVP size, real answer needed once other
  syndicates depend on it)

## What already exists
A **visual/UX prototype** was built and published as a Claude artifact — a
"flight-strip board" styled booking calendar (chart-paper palette, IBM Plex
Mono for data, Inter for UI text), with click-to-book, clash detection, a
member legend, and a squawk log. It's a look-and-feel and interaction
reference only — it stores data in browser localStorage, not a real
database, and has no real login. Worth rebuilding properly rather than
reusing the code, but the visual direction was well received and is worth
carrying forward.
