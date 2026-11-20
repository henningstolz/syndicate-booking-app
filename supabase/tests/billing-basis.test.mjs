// The billing basis: a group bills its hourly charge by block time (brakes off to on, the way it has always
// been) or by flight time (airborne to landed), from a chosen month. Checks that nothing changes until an
// admin chooses, that the choice applies from its month onwards (earlier months keep their basis, a later
// choice replaces an earlier one), who may choose, that a closed month keeps its saved figures and says
// which basis they were worked out with, and that a deleted group takes its choices with it.
// (The random-month comparison with the TypeScript twin, in costs.test.mjs, also covers both bases.)
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";
import { minutesToDeci } from "../../src/lib/flight-times.ts";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "eve");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111"; // alice admin, bob and cara members
const G2 = "22222222-2222-2222-2222-222222222222"; // eve admin
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name,created_at) values
    ($1,$2,'admin','Alice','2024-01-01T12:00:00Z'), ($1,$3,'member','Bob','2024-01-01T12:00:00Z'),
    ($1,$4,'member','Cara','2024-01-01T12:00:00Z'), ($5,$6,'admin','Eve','2024-01-01T12:00:00Z')`,
  [G1, U.alice, U.bob, U.cara, G2, U.eve],
);

const stmt = async (user, month, group = G1) => rpc(user, "cost_statement", group, month);
const basis = (user, month, value, group = G1) => rpc(user, "set_cost_billing_basis", group, month, value);
const member = (s, name) => s.members.find((m) => m.name === name);

// A flight put straight into the table (the real add-flight rule refuses some of these dates): 09:00 brakes
// off, 09:10 airborne, 10:20 landed, 10:30 brakes on = 90 block minutes and 70 flight minutes.
const put = async (captain, date, { void: voided = false } = {}) => {
  await db.exec("reset role");
  const t = (hhmm) => `${date}T${hhmm}:00Z`;
  await db.query(
    `insert into public.flight_entries (group_id, flight_date, from_place, to_place, flight_category, captain_id, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, created_by, voided_at, voided_by, void_reason)
     values ($1, $2::date, 'A', 'B', 'PV', $3, 'x', 1, 1, 1, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [G1, date, U[captain], t("09:00"), t("09:10"), t("10:20"), t("10:30"), U.alice, voided ? "2026-01-01T00:00:00Z" : null, voided ? U.alice : null, voided ? "test" : null],
  );
};
const BLOCK = Number(minutesToDeci(90) * 10); // 15 tenths
const FLIGHT = Number(minutesToDeci(70) * 10); // 12 tenths
check("the test flight really has different block and flight hours", BLOCK > FLIGHT, true);

// Rates from 2024: fee 100.00, 60.00 an hour.
check("rates are set", result(await rpc("alice", "set_cost_rate", G1, "2024-01-01", 10000, 6000)), "ok");
for (const d of ["2025-02-10", "2025-03-10", "2025-04-10", "2025-05-10"]) await put("bob", d);
await put("bob", "2025-03-11", { void: true });

// ------------------------------------------------------------ nothing changes until a group chooses
let s = await stmt("alice", "2025-03-01");
check("a group that never chose is billed by block time", [s.billing_basis, s.hours_tenths, member(s, "Bob").hourly_pence], ["block", BLOCK, Math.round((BLOCK * 6000) / 10)]);

// ---------------------------------------------------------------------------------- who may choose
check("a member cannot choose", result(await basis("bob", "2025-03-01", "flight")), "not_allowed");
check("an admin of another group cannot", result(await basis("eve", "2025-03-01", "flight")), "not_allowed");
check("anonymous cannot", (await rpc(null, "set_cost_billing_basis", G1, "2025-03-01", "flight")).thrown?.includes("permission denied") ?? false, true);
check("only 'block' or 'flight' are accepted", [result(await basis("alice", "2025-03-01", "minutes")), result(await basis("alice", "2025-03-01", null)), result(await basis("alice", "2025-03-01", ""))], ["basis_invalid", "basis_invalid", "basis_invalid"]);
check("a silly month is refused", [result(await basis("alice", "1990-01-01", "flight")), result(await basis("alice", "2101-01-01", "flight")), result(await basis("alice", null, "flight"))], ["month_invalid", "month_invalid", "month_invalid"]);
await db.exec("reset role");
check("nothing was saved by the refused calls", (await db.query("select count(*)::int n from public.cost_billing_basis")).rows[0].n, 0);
check("members cannot write the table directly", (await q("bob", "insert into public.cost_billing_basis (group_id, effective_month, basis, created_by) values ($1,'2025-01-01','flight',$2)", [G1, U.bob])).thrown?.includes("row-level security") ?? false, true);
await db.exec("reset role");
check("the table only takes 'block' or 'flight' (database rule)", (await db.query("insert into public.cost_billing_basis (group_id, effective_month, basis, created_by) values ($1,'2025-01-01','minutes',$2)", [G1, U.alice]).then(() => false, (e) => String(e.message).includes("violates check constraint"))), true);
check("and only the first day of a month", (await db.query("insert into public.cost_billing_basis (group_id, effective_month, basis, created_by) values ($1,'2025-01-15','flight',$2)", [G1, U.alice]).then(() => false, (e) => String(e.message).includes("violates check constraint"))), true);

// ------------------------------------------------------------------- a choice applies from its month
check("an admin chooses flight time from March 2025 (a mid-month date counts as the 1st)", result(await basis("alice", "2025-03-17", "flight")), "ok");
s = await stmt("alice", "2025-03-01");
check("March: billed by flight time", [s.billing_basis, s.hours_tenths, member(s, "Bob").hours_tenths, member(s, "Bob").hourly_pence, s.flights.map((f) => f.hours_tenths)], ["flight", FLIGHT, FLIGHT, Math.round((FLIGHT * 6000) / 10), [FLIGHT]]);
check("...a voided flight still does not count", s.flights.length, 1);
s = await stmt("alice", "2025-02-01");
check("February (before the choice) is still block time", [s.billing_basis, s.hours_tenths], ["block", BLOCK]);
s = await stmt("alice", "2025-04-01");
check("April (after the choice, no newer one) is flight time", [s.billing_basis, s.hours_tenths], ["flight", FLIGHT]);
s = await stmt("bob", "2025-04-01");
check("a member's own statement uses the same basis", [s.billing_basis, member(s, "Bob").hours_tenths, s.is_admin], ["flight", FLIGHT, false]);

check("a later choice: block time again from May 2025", result(await basis("alice", "2025-05-01", "block")), "ok");
check("March and April stay on flight time, May is block", [(await stmt("alice", "2025-03-01")).billing_basis, (await stmt("alice", "2025-04-01")).billing_basis, (await stmt("alice", "2025-05-01")).billing_basis], ["flight", "flight", "block"]);
check("two choices for the same month: the newer one wins", [result(await basis("alice", "2025-05-01", "flight")), (await stmt("alice", "2025-05-01")).billing_basis], ["ok", "flight"]);
check("a month with no flights still reports its basis", (await stmt("alice", "2025-07-01")).billing_basis, "flight");

// --------------------------------------------------------------------------------- who can read it
check("members can read the choices", (await q("bob", "select count(*)::int n from public.cost_billing_basis"))[0].n, 3);
check("another group's member cannot", (await q("eve", "select count(*)::int n from public.cost_billing_basis where group_id = $1", [G1]))[0].n, 0);
check("another group is not affected by these choices", (await stmt("eve", "2025-03-01", G2)).billing_basis, "block");

// ---------------------------------------------------------------------- a closed month stays as saved
// March is closed while billed by flight time; changing the basis afterwards must not alter it.
const closed = await rpc("alice", "close_cost_month", G1, "2025-03-01");
check("March is closed", result(closed), "ok");
await db.exec("reset role");
check("the saved statement records the basis it was worked out with", (await db.query("select snapshot->>'billing_basis' b, (snapshot->>'hours_tenths')::int t from public.cost_month_closures where group_id = $1 and month = '2025-03-01'", [G1])).rows[0], { b: "flight", t: FLIGHT });

check("now the admin switches March back to block time", result(await basis("alice", "2025-03-01", "block")), "ok");
s = await stmt("alice", "2025-03-01");
check("the closed month keeps its flight-time figures and says so", [s.closed !== null, s.billing_basis, s.hours_tenths, member(s, "Bob").hourly_pence], [true, "flight", FLIGHT, Math.round((FLIGHT * 6000) / 10)]);
check("...and shows the admin the difference (drift) against the live calculation", s.drift.map((d) => [d.closed_tenths, d.now_tenths]), [[FLIGHT, BLOCK]]);
s = await stmt("bob", "2025-03-01");
check("a member sees the same saved figures, no drift", [s.closed !== null, s.billing_basis, member(s, "Bob").hours_tenths, s.drift.length], [true, "flight", FLIGHT, 0]);
check("reopening works as before", result(await rpc("alice", "reopen_cost_month", G1, "2025-03-01", "basis changed")), "ok");
s = await stmt("alice", "2025-03-01");
check("a reopened month is worked out live again, with the basis now in force", [s.closed, s.billing_basis, s.hours_tenths], [null, "block", BLOCK]);

// ------------------------------------------------------------------ an old snapshot has no basis field
await db.exec("reset role");
await db.exec(`update public.cost_month_closures set snapshot = snapshot - 'billing_basis', reopened_at = null, reopened_by = null, reopen_reason = null where group_id = '${G1}'`);
s = await stmt("alice", "2025-03-01");
check("a month saved before the choice existed has no basis field (the app treats that as block time)", [s.closed !== null, s.billing_basis === undefined], [true, true]);

// ------------------------------------------------------------------------- deleting a group
await db.exec("reset role");
await db.exec(`delete from public.groups where id = '${G1}'`);
check("deleting a group takes its billing choices with it", (await db.query("select count(*)::int n from public.cost_billing_basis where group_id = $1", [G1])).rows[0].n, 0);

h.finish();
