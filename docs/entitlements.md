# Entitlements: may this group write right now?

One module answers it: `src/lib/entitlements/`. It is built and wired in, but **billing
enforcement is off** (`billing_enforcement_enabled` is `false` in the platform settings), so
today every group can always write and nothing looks different.

## How to use it

- `getEntitlements(supabase, groupId)` returns `{ mode: "full" | "read_only", reasons, limits }`.
  One call to the database function `get_group_entitlement_inputs` (migration 0026), which any
  current member of the group may call and which returns only the plan, billing status, trial end,
  paid-until, price lock and the platform settings.
- `assertCanWrite(supabase, groupId)` returns `null` when writing is allowed, or `{ error }` with
  the sentence to show ("This group is read-only at the moment. Please contact your group admin.").
  It returns a value instead of throwing because the actions answer with an error state or a
  redirect. Call it after the sign-in check and before the write.
- In the demo (`/demo`) the check is skipped.
- **Anything unexpected allows the write**: a missing function, a database error (also reported to
  Sentry), a group with no plan row, an unknown plan or status, a date that cannot be read, a switch
  that is not a real `true`. A problem in the plan data must never lock a group out of its aircraft.

## Where the pieces are

| File | What it holds |
| --- | --- |
| `plans.ts` | The plan definitions: name, member limit, aircraft limit (`null` = unlimited). **All limits are `null` for now**; change them here when the numbers are decided. |
| `compute-mode.ts` | `computeMode()`, the rules below (pure, unit-tested), and `memberLimitReached` / `aircraftLimitReached`. |
| `evaluate.ts` | Turns the database's answer into a result; fails open. |
| `index.ts` | The server part: `getEntitlements`, `assertCanWrite`. |
| `messages.ts` | The read-only sentence. |

## The rules (only when enforcement is ON)

Checked in this order; the first that applies decides. "Today" is the UK date. The grace period is a
platform setting (14 days to start with).

1. `complimentary` is always full.
2. A `founding` group whose price lock has not ended (the last day counts) is always full.
3. Billing status `none` ("not billed", the free beta) is full.
4. `cancelled` is read-only.
5. A paid-until date that is today or later, or passed by no more than the grace period, is full.
6. Status `trial`: full until the trial end plus the grace period, then read-only. A trial with no end
   date is full.
7. Status `active` with no paid-until date is full.
8. Anything else (a lapsed paid-until, `past_due` with nothing covering it) is read-only.

## Which actions are guarded

Guarded: create a booking, post a chat message, add a flight log entry, add an expense, create an
invite. **Never blocked:** reading anything, signing in, cancelling your own bookings, voiding an
entry, closing months, rates, recording payments (a group must still be able to settle up), leaving a
group, the data export. There is no "create aircraft" (a group has one aircraft); editing it is not
guarded. The member and aircraft limits exist as helpers but no action calls them yet.

## Before enforcement is ever switched on

The check above runs in the app's server actions. It cannot stop a member who calls the database
directly (bookings, chat and invites are plain row-security inserts, and uploads go from the browser).
So **do not switch enforcement on until the same rule is also checked in the database** (the write
functions and policies asking "is this group writable?"). Also add a visible read-only notice in the
app, and decide the limit numbers.
