// Cost statement database test: the fixed share, the hourly charge, members'
// own rates and the expenses they paid worked out by hand, every rule (rates by
// month, guests, joining and leaving, voids), who may see what, and finally
// hundreds of random months compared with the TypeScript twin (src/lib/costs.ts)
// so the two cannot drift.
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";
import { computeStatement } from "../../src/lib/costs.ts";
import { minutesToDeci } from "../../src/lib/flight-times.ts";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve", "u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name,created_at,removed_at) values
    ($1,$2,'admin','Alice','2025-01-01T12:00:00Z',null),
    ($1,$3,'member','Bob','2025-01-01T12:00:00Z',null),
    ($1,$4,'member','Cara','2025-01-01T12:00:00Z',null),
    ($1,$5,'member','Dan','2025-01-01T12:00:00Z','2026-09-15T12:00:00Z'),
    ($6,$7,'admin','Eve','2025-01-01T12:00:00Z',null)`,
  [G1, U.alice, U.bob, U.cara, U.dan, G2, U.eve],
);

const stmt = async (user, month = "2026-10-01", group = G1) => rpc(user, "cost_statement", group, month);
const member = (s, name) => s.members.find((m) => m.name === name);
const rate = (user, month, fee, hourly, group = G1) => rpc(user, "set_cost_rate", group, month, fee, hourly);
const ownRate = (user, who, month, fee, hourly, group = G1) => rpc(user, "set_member_cost_rate", group, U[who] ?? who, month, fee, hourly);
const expense = (user, who, date, pence, o = {}) => rpc(user, "add_cost_expense", o.group ?? G1, U[who] ?? who, date, o.description ?? "Fuel away", pence);
const flight = (user, o = {}) => rpc(user, "add_flight_entry", G1, "eglm", "eglm", "PV", o.captain === undefined ? U[user] : o.captain, o.captainName ?? null, 24, 23.5, 7, o.off, o.up, o.down, o.on, null);
// A flight with a given BLOCK time in minutes on a given day (UTC times).
const day = (d, startHour, blockMinutes) => {
  const off = new Date(`${d}T${String(startHour).padStart(2, "0")}:00:00Z`);
  const at = (m) => new Date(off.getTime() + m * 60000).toISOString();
  // airborne and landed sit inside the block, however short it is
  return { off: at(0), up: at(Math.floor(blockMinutes / 3)), down: at(Math.floor((2 * blockMinutes) / 3)), on: at(blockMinutes) };
};

// The real add-flight rule refuses a flight that starts in the future, and several
// scenarios here are in 2027. This puts a flight straight into the table, with its
// UK date worked out the way the real function does.
const put = async (user, o) => {
  await db.exec("reset role");
  const captain = o.captain === undefined ? U[user] : o.captain;
  await db.query(
    `insert into public.flight_entries (group_id, flight_date, from_place, to_place, flight_category, captain_id, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, created_by)
     values ($1, ($2::timestamptz at time zone 'Europe/London')::date, 'A', 'B', 'PV', $3, $4, 1, 1, 1, $2, $5, $6, $7, $8)`,
    [G1, o.off, captain, o.captainName ?? "Someone", o.up, o.down, o.on, U[user]],
  );
};

// -------------------------------------------------------------- rates
check("a member cannot set rates", result(await rate("bob", "2026-01-01", 12000, 6500)), "not_allowed");
check("anonymous cannot", (await rpc(null, "set_cost_rate", G1, "2026-01-01", 1, 1)).thrown?.includes("permission denied") ?? false, true);
check("an admin of another group cannot", result(await rate("eve", "2026-01-01", 12000, 6500)), "not_allowed");
check("negative amounts refused", result(await rate("alice", "2026-01-01", -1, 6500)), "amount_invalid");
check("absurd amounts refused", result(await rate("alice", "2026-01-01", 12000, 10000001)), "amount_invalid");
check("missing amounts refused", result(await rate("alice", "2026-01-01", null, 6500)), "amount_invalid");
check("a silly month refused", result(await rate("alice", "1990-01-01", 1, 1)), "month_invalid");
check("rates are saved", result(await rate("alice", "2026-01-01", 11000, 6000)), "ok");
check("a mid-month date is treated as that month's first day", result(await rate("alice", "2026-04-17", 12000, 6500)), "ok");
await db.exec("reset role");
check("rows start on the first of the month, history kept", (await db.query("select effective_month::text m, monthly_fee_pence f, hourly_rate_pence r from public.cost_rates where group_id=$1 order by effective_month", [G1])).rows, [{ m: "2026-01-01", f: 11000, r: 6000 }, { m: "2026-04-01", f: 12000, r: 6500 }]);
check("members can read the rates", (await q("bob", "select count(*)::int n from public.cost_rates"))[0].n, 2);
check("another group's member cannot", (await q("eve", "select count(*)::int n from public.cost_rates where group_id = $1", [G1]))[0].n, 0);
check("members cannot write rates directly", (await q("bob", "insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,'2026-06-01',1,1,$2)", [G1, U.bob])).thrown?.includes("row-level security") ?? false, true);

// ------------------------------------------------ individual rates: rules
check("a member cannot set individual rates", result(await ownRate("bob", "cara", "2026-10-01", 0, 9000)), "not_allowed");
check("an admin of another group cannot", result(await ownRate("eve", "bob", "2026-10-01", 0, 9000)), "not_allowed");
check("anonymous cannot", (await rpc(null, "set_member_cost_rate", G1, U.bob, "2026-10-01", 0, 1)).thrown?.includes("permission denied") ?? false, true);
check("the member must belong to the group", result(await ownRate("alice", "eve", "2026-10-01", 0, 9000)), "member_invalid");
check("a removed member cannot be given rates", result(await ownRate("alice", "dan", "2026-10-01", 0, 9000)), "member_invalid");
check("negative amounts refused", result(await ownRate("alice", "bob", "2026-10-01", -1, 9000)), "amount_invalid");
check("absurd amounts refused", result(await ownRate("alice", "bob", "2026-10-01", 0, 10000001)), "amount_invalid");
check("a silly month refused", result(await ownRate("alice", "bob", "1990-01-01", 0, 1)), "month_invalid");
await db.exec("reset role");
check("nothing was saved by the refused calls", (await db.query("select count(*)::int n from public.cost_rates where user_id is not null")).rows[0].n, 0);
check("a group row must have both amounts (database rule)", (await db.query("insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,'2026-06-01',null,5,$2)", [G1, U.alice]).then(() => false, (e) => String(e.message).includes("cost_rates_group_rows_complete"))), true);

// ------------------------------------------------ expenses: rules
check("a member cannot add an expense", result(await expense("bob", "bob", "2026-10-05", 5000)), "not_allowed");
check("an admin of another group cannot", result(await expense("eve", "bob", "2026-10-05", 5000)), "not_allowed");
check("the payer must be a current member of the group", result(await expense("alice", "eve", "2026-10-05", 5000)), "member_invalid");
check("a removed member cannot be the payer", result(await expense("alice", "dan", "2026-10-05", 5000)), "member_invalid");
check("description required", result(await expense("alice", "bob", "2026-10-05", 5000, { description: "  " })), "description_required");
check("description length limited", result(await expense("alice", "bob", "2026-10-05", 5000, { description: "x".repeat(121) })), "description_too_long");
check("amount must be positive", result(await expense("alice", "bob", "2026-10-05", 0)), "amount_invalid");
check("amount must not be absurd", result(await expense("alice", "bob", "2026-10-05", 10000001)), "amount_invalid");
check("date must be sensible (not far future)", result(await expense("alice", "bob", "2999-01-01", 100)), "date_invalid");
check("date must be sensible (not ancient)", result(await expense("alice", "bob", "1999-12-31", 100)), "date_invalid");
await db.exec("reset role");
check("nothing was saved by the refused calls", (await db.query("select count(*)::int n from public.cost_expenses")).rows[0].n, 0);

// ------------------------------------------------ a month worked out by hand
// October 2026: group rates fee 120.00 / 65.00 an hour (April's). Bob flew 90
// block minutes (1.5 h = 15 tenths), Cara 100 (1.7 h = 17 tenths).
await flight("bob", day("2026-10-06", 9, 90));
await flight("cara", day("2026-10-07", 9, 100));
let s = await stmt("alice");
check("the statement succeeds for an admin", [s.result, s.is_admin, s.month], ["ok", true, "2026-10-01"]);
check("the rates in force are April's (the latest before October)", [s.rates.fee_pence, s.rates.hourly_pence, s.rates.missing], [12000, 6500, false]);
check("the month's totals", [s.hours_tenths, s.credits_pence], [32, 0]);
check("the statement has no leftover fuel fields", [Object.keys(s).includes("fuel_pence"), Object.keys(s.members[0]).includes("fuel_pence")], [false, false]);
await db.exec("reset role");
check("the old fuel pot is gone (table and functions)", (await db.query("select to_regclass('public.cost_items') is null t, to_regprocedure('public.add_cost_item(uuid,date,text,text,integer)') is null a, to_regprocedure('public.void_cost_item(uuid,text)') is null v, to_regprocedure('public.cost_month_flights(uuid,date,date,integer)') is null h")).rows[0], { t: true, a: true, v: true, h: true });
check("members are Alice, Bob, Cara (Dan left in September)", s.members.map((m) => m.name), ["Alice", "Bob", "Cara"]);
check("everyone pays the fixed share", s.members.map((m) => m.fixed_pence), [12000, 12000, 12000]);
check("hourly: 15 tenths x 6500 / 10 = 9750 and 17 tenths = 11050", [member(s, "Alice").hourly_pence, member(s, "Bob").hourly_pence, member(s, "Cara").hourly_pence], [0, 9750, 11050]);
check("totals are fixed + flying", s.members.map((m) => m.total_pence), [12000, 21750, 23050]);
check("nobody has own rates yet", s.members.map((m) => m.custom_rates), [false, false, false]);
check("flights listed with their charge", s.flights.map((f) => [f.user_id === U.bob ? "bob" : "cara", f.hours_tenths, f.pence]), [["bob", 15, 9750], ["cara", 17, 11050]]);

// ------------------------------------------------ individual rates
// Bob owns no share and pays no fixed costs, but pays 90.00 an hour.
check("an admin sets Bob's own rates", result(await ownRate("alice", "bob", "2026-10-01", 0, 9000)), "ok");
s = await stmt("alice");
check("Bob: no fixed share, 15 tenths x 9000 / 10 = 13500", [member(s, "Bob").fixed_pence, member(s, "Bob").hourly_pence, member(s, "Bob").total_pence, member(s, "Bob").custom_rates], [0, 13500, 13500, true]);
check("...his own rates are shown on his line", [member(s, "Bob").fee_pence, member(s, "Bob").hourly_rate_pence], [0, 9000]);
check("...his flight is charged at his rate", s.flights.filter((f) => f.user_id === U.bob).map((f) => f.pence), [13500]);
check("everyone else is unchanged", [member(s, "Alice").total_pence, member(s, "Cara").total_pence, member(s, "Cara").custom_rates], [12000, 23050, false]);
check("the group's own rates are unchanged", [s.rates.fee_pence, s.rates.hourly_pence], [12000, 6500]);
// A part left empty follows the group.
check("a newer row for the same month replaces it: only the hourly rate", result(await ownRate("alice", "bob", "2026-10-01", null, 9000)), "ok");
s = await stmt("alice");
check("...the empty part follows the group's share", [member(s, "Bob").fixed_pence, member(s, "Bob").hourly_pence, member(s, "Bob").custom_rates], [12000, 13500, true]);
check("only a fixed share", result(await ownRate("alice", "bob", "2026-10-01", 5000, null)), "ok");
s = await stmt("alice");
check("...the empty hourly rate follows the group's", [member(s, "Bob").fixed_pence, member(s, "Bob").hourly_pence], [5000, 9750]);
check("both empty puts the member back on the group's rates", result(await ownRate("alice", "bob", "2026-10-01", null, null)), "ok");
s = await stmt("alice");
check("...back to the group's rates", [member(s, "Bob").fixed_pence, member(s, "Bob").hourly_pence, member(s, "Bob").total_pence, member(s, "Bob").custom_rates], [12000, 9750, 21750, false]);
check("then Bob's special rates again", result(await ownRate("alice", "bob", "2026-10-01", 0, 9000)), "ok");
check("an own rate starting in November does not touch October", result(await ownRate("alice", "bob", "2026-11-01", 0, 12000)), "ok");
s = await stmt("alice");
check("...October still has the October row", [member(s, "Bob").hourly_pence], [13500]);
check("a zero hourly rate is a real zero (a flight is free)", result(await ownRate("alice", "cara", "2026-10-15", 12000, 0)), "ok");
s = await stmt("alice");
check("...and mid-month dates count from the first of that month", [member(s, "Cara").hourly_pence, member(s, "Cara").hourly_rate_pence, member(s, "Cara").custom_rates], [0, 0, true]);
check("Cara back to the group's", result(await ownRate("alice", "cara", "2026-10-01", null, null)), "ok");
s = await stmt("alice");
check("...and her flying is charged again", member(s, "Cara").hourly_pence, 11050);

// ------------------------------------------------ who sees which rates
await db.exec("reset role");
check("a member sees the group's rates and their own, not others'", (await q("bob", "select user_id, monthly_fee_pence f from public.cost_rates where group_id = $1 order by effective_month, created_at", [G1])).every((r) => r.user_id === null || r.user_id === U.bob), true);
check("Cara sees none of Bob's rows", (await q("cara", "select count(*)::int n from public.cost_rates where user_id = $1", [U.bob]))[0].n, 0);
check("Bob sees his own rows", (await q("bob", "select count(*)::int n from public.cost_rates where user_id = $1", [U.bob]))[0].n > 0, true);
check("an admin sees everyone's", (await q("alice", "select count(distinct user_id)::int n from public.cost_rates where user_id is not null"))[0].n, 2);
check("another group's member sees nothing of ours", (await q("eve", "select count(*)::int n from public.cost_rates where group_id = $1", [G1]))[0].n, 0);
check("members cannot write own rates directly", (await q("bob", "insert into public.cost_rates (group_id, user_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,$2,'2026-06-01',0,1,$2)", [G1, U.bob])).thrown?.includes("row-level security") ?? false, true);

// ------------------------------------------------ expenses on the statement
// Cara bought fuel away from home (40.00), Bob too (25.50); Alice a big one (500.00).
check("an admin records Cara's expense", result(await expense("alice", "cara", "2026-10-03", 4000, { description: "Fuel at Sywell" })), "ok");
check("and Bob's", result(await expense("alice", "bob", "2026-10-05", 2550)), "ok");
await db.exec("reset role");
// (inserted directly: the real rule refuses a date more than a day ahead)
await db.query("insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by) values ($1,$2,'2026-11-02','Nov',9999,$3)", [G1, U.cara, U.alice]);
s = await stmt("alice");
check("each member's credit is what they paid", [member(s, "Alice").credit_pence, member(s, "Bob").credit_pence, member(s, "Cara").credit_pence], [0, 2550, 4000]);
check("totals = fixed + flying - credit (Bob has his own rates: 0 + 13500)", [member(s, "Alice").total_pence, member(s, "Bob").total_pence, member(s, "Cara").total_pence], [12000, 13500 - 2550, 23050 - 4000]);
check("the month's expenses add up", s.credits_pence, 6550);
check("expenses are listed with who paid", s.expenses.map((e) => [e.user_id === U.bob ? "bob" : "cara", e.pence, e.description]), [["cara", 4000, "Fuel at Sywell"], ["bob", 2550, "Fuel away"]]);
check("November has its own expense", [(await stmt("alice", "2026-11-01")).credits_pence, (await stmt("alice", "2026-11-01")).expenses.length], [9999, 1]);
s = await stmt("cara");
check("a member sees only their own expense in the list", [s.expenses.length, s.expenses[0].pence], [1, 4000]);
check("...but the month's total includes everyone's", s.credits_pence, 6550);
await db.exec("reset role");
check("a member reads only their own expenses directly", (await q("bob", "select count(*)::int n from public.cost_expenses"))[0].n, 1);
check("an admin reads all of them", (await q("alice", "select count(*)::int n from public.cost_expenses"))[0].n, 3);
check("another group's admin reads none", (await q("eve", "select * from public.cost_expenses")).length, 0);
check("nobody can edit an expense", (await q("alice", "update public.cost_expenses set amount_pence = 1 returning id")).length, 0);
check("nobody can delete an expense", (await q("alice", "delete from public.cost_expenses returning id")).length, 0);
check("a member cannot insert one directly", (await q("bob", "insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by) values ($1,$2,'2026-10-01','x',1,$2)", [G1, U.bob])).thrown?.includes("row-level security") ?? false, true);

// An expense bigger than the bill leaves a credit (negative total).
check("a big expense for Alice", result(await expense("alice", "alice", "2026-10-04", 50000, { description: "Annual parts" })), "ok");
s = await stmt("alice");
check("her total is negative: money owed to her", member(s, "Alice").total_pence, 12000 - 50000);

// ------------------------------------------------ voiding an expense
await db.exec("reset role");
const bigId = (await db.query("select id from public.cost_expenses where description = 'Annual parts'")).rows[0].id;
check("a member cannot void", result(await rpc("bob", "void_cost_expense", bigId, "mistake")), "not_allowed");
check("a reason is required", result(await rpc("alice", "void_cost_expense", bigId, "  ")), "reason_required");
check("the reason has a limit", result(await rpc("alice", "void_cost_expense", bigId, "x".repeat(301))), "reason_too_long");
check("unknown expense", result(await rpc("alice", "void_cost_expense", "00000000-0000-0000-0000-000000000000", "mistake")), "not_found");
check("another group's admin cannot void", result(await rpc("eve", "void_cost_expense", bigId, "not mine")), "not_allowed");
check("an admin voids it", result(await rpc("alice", "void_cost_expense", bigId, "entered twice")), "ok");
check("it cannot be voided twice", result(await rpc("alice", "void_cost_expense", bigId, "again")), "already_voided");
s = await stmt("alice");
check("a voided expense stops counting", [member(s, "Alice").credit_pence, member(s, "Alice").total_pence, s.credits_pence], [0, 12000, 6550]);
await db.exec("reset role");
check("...but stays on record with its reason", (await db.query("select void_reason from public.cost_expenses where id = $1", [bigId])).rows[0].void_reason, "entered twice");

// ------------------------------------------------ who sees what
s = await stmt("bob");
check("a member sees only their own statement and flights", [s.is_admin, s.members.map((m) => m.name), s.flights.map((f) => f.hours_tenths)], [false, ["Bob"], [15]]);
check("...but the month's totals they need to understand it", [s.hours_tenths, s.rates.hourly_pence], [32, 6500]);
check("...and their own numbers are the same as the admin sees", member(s, "Bob").total_pence, 13500 - 2550);
s = await stmt("alice", "2026-10-01", G2);
check("an admin of another group has no access", s.result, "not_allowed");
check("a removed member has no access", (await stmt("dan")).result, "not_allowed");
check("anonymous has no access", (await rpc(null, "cost_statement", G1, "2026-10-01")).thrown?.includes("permission denied") ?? false, true);
check("a bad month is refused", (await stmt("alice", "1990-01-01")).result, "month_invalid");

// ------------------------------------------------ voided flights stop counting
await db.exec("reset role");
const bobFlight = (await db.query("select id from public.flight_entries where captain_name = 'Bob'")).rows[0].id;
await rpc("alice", "void_flight_entry", bobFlight, "wrong day");
s = await stmt("alice");
check("a voided flight leaves the hours and the charge", [s.hours_tenths, member(s, "Bob").hourly_pence], [17, 0]);

// ---------------------------------------------------- guests and loggers
await put("bob", { ...day("2026-10-12", 9, 60), captain: null, captainName: "Guest Pilot" });
s = await stmt("alice");
check("a guest captain's flight is charged to the member who logged it, at their rate", [member(s, "Bob").hours_tenths, member(s, "Bob").hourly_pence], [10, 9000]);
await put("alice", { ...day("2026-10-13", 9, 60), captain: U.cara, captainName: "Cara" });
s = await stmt("alice");
check("a flight logged by one member for another member is charged to the captain", [member(s, "Alice").hours_tenths, member(s, "Cara").hours_tenths], [0, 17 + 10]);

// -------------------------------------------- rates change from a month
check("a new rate from November", result(await rate("alice", "2026-11-01", 15000, 7000)), "ok");
await put("bob", { ...day("2026-11-03", 9, 60), captainName: "Bob" });
s = await stmt("alice", "2026-11-15");
check("November uses the new group rates (Cara has none of her own)", [s.rates.fee_pence, s.rates.hourly_pence, member(s, "Cara").hourly_pence, member(s, "Cara").fixed_pence], [15000, 7000, 0, 15000]);
check("...and Bob's own November rates (0 / 120.00)", [member(s, "Bob").fixed_pence, member(s, "Bob").hourly_pence], [0, 12000]);
s = await stmt("alice", "2026-10-15");
check("October is unchanged by the later rate (any day in the month works)", [s.rates.fee_pence, s.rates.hourly_pence, member(s, "Cara").hourly_pence], [12000, 6500, 17 * 650 + 10 * 650]);
check("a later correction for the same month replaces the earlier one", result(await rate("alice", "2026-11-01", 15500, 7000)), "ok");
check("...the newest row for a month wins", (await stmt("alice", "2026-11-01")).rates.fee_pence, 15500);
s = await stmt("alice", "2026-02-01");
check("February (before April's rates) uses January's", [s.rates.fee_pence, s.rates.hourly_pence], [11000, 6000]);
s = await stmt("alice", "2025-06-01");
check("a month before any rates is flagged, with zero rates", [s.rates.missing, s.rates.fee_pence, s.rates.hourly_pence], [true, 0, 0]);

// ------------------------------------------------ odd pence per flight
await rate("alice", "2027-01-01", 0, 6505);
await ownRate("alice", "bob", "2027-01-01", null, null);   // Bob back on the group's rates
await put("bob", { ...day("2027-01-05", 9, 6), captainName: "Bob" });   // 6 min = 0.1 h = 1 tenth -> 650.5 p -> 651
await put("bob", { ...day("2027-01-06", 9, 12), captainName: "Bob" });  // 0.2 h -> 2 tenths -> 1301 p
s = await stmt("alice", "2027-01-01");
check("each flight's charge is rounded half up to a whole penny", s.flights.map((f) => f.pence), [651, 1301]);
check("and the member's hourly total is the sum of those, so the lines add up", member(s, "Bob").hourly_pence, 651 + 1301);

// -------------------------------------------- no flights, an expense
await db.exec("reset role");
await db.query("insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by) values ($1,$2,'2027-03-02','x',1000,$3)", [G1, U.cara, U.alice]);
s = await stmt("alice", "2027-03-01");
check("a month with only an expense (the January 2027 rates have no fixed share): just the credit to the payer", [s.hours_tenths, s.members.map((m) => m.total_pence)], [0, [0, 0, -1000]]);

// ------------------------------------------------ closing a month
// September 2026: Bob flew 1.5 h, Cara 1.0 h, Cara paid 30.00 of fuel away from home.
const SEP = "2026-09-01";
const nowDate = new Date();
const thisMonthStart = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
await put("bob", { ...day("2026-09-08", 9, 90), captainName: "Bob" });
await put("cara", { ...day("2026-09-09", 9, 60), captainName: "Cara" });
await db.exec("reset role");
await db.query("insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by) values ($1,$2,'2026-09-05','Fuel away',3000,$3)", [G1, U.cara, U.alice]);
const figures = (x) => JSON.stringify([x.rates, x.hours_tenths, x.credits_pence, x.members, x.flights, x.expenses]);
const closure = (user, fn, ...args) => rpc(user, fn, G1, ...args);
s = await stmt("alice", SEP);
const septBefore = figures(s);
check("an open past month can be closed by an admin (and is not closed yet)", [s.closed, s.can_close, s.drift], [null, true, []]);
check("a member is not offered it", (await stmt("bob", SEP)).can_close, false);
check("the current month cannot be closed (it is not over)", [result(await closure("alice", "close_cost_month", thisMonthStart)), result(await closure("alice", "close_cost_month", "2099-01-01"))], ["month_not_over", "month_not_over"]);
check("...so it is not offered either", (await stmt("alice", thisMonthStart)).can_close, false);
check("a month without rates cannot be closed (it would freeze zeros)", result(await closure("alice", "close_cost_month", "2025-06-01")), "rates_missing");
check("a silly month is refused", result(await closure("alice", "close_cost_month", "1990-01-01")), "month_invalid");
check("a member cannot close", result(await closure("bob", "close_cost_month", SEP)), "not_allowed");
check("an admin of another group cannot", result(await rpc("eve", "close_cost_month", G1, SEP)), "not_allowed");
check("anonymous cannot", (await rpc(null, "close_cost_month", G1, SEP)).thrown?.includes("permission denied") ?? false, true);
check("the note has a limit", result(await closure("alice", "close_cost_month", SEP, "x".repeat(301))), "note_too_long");
check("nothing was saved by the refused calls", (await q("alice", "select count(*)::int n from public.cost_month_closures"))[0].n, 0);
check("an admin closes September", result(await closure("alice", "close_cost_month", SEP, "  Checked with the group  ")), "ok");
check("it cannot be closed twice", result(await closure("alice", "close_cost_month", SEP)), "already_closed");
s = await stmt("alice", SEP);
check("the closed month shows exactly the figures as they stood", figures(s), septBefore);
check("...with who closed it, when and the note", [s.closed.closed_by_name, s.closed.note, typeof s.closed.closed_at, s.can_close, s.drift], ["Alice", "Checked with the group", "string", false, []]);
const bobClosed = await stmt("bob", SEP);
check("a member sees the closed month with only their own part", [bobClosed.is_admin, bobClosed.closed.closed_by_name, bobClosed.members.map((m) => m.name), bobClosed.flights.map((f) => f.hours_tenths), bobClosed.expenses.length, bobClosed.can_close, bobClosed.drift], [false, "Alice", ["Bob"], [15], 0, false, []]);
check("...with the same total as the admin sees", member(bobClosed, "Bob").total_pence, member(s, "Bob").total_pence);
const caraClosed = await stmt("cara", SEP);
check("a member sees their own expense in it", [caraClosed.expenses.length, caraClosed.members.map((m) => m.name), member(caraClosed, "Cara").credit_pence], [1, ["Cara"], 3000]);
check("...and the group's month totals", [caraClosed.hours_tenths, caraClosed.credits_pence], [s.hours_tenths, 3000]);
check("a non-member of the group cannot read it", (await stmt("eve", SEP)).result, "not_allowed");
check("members cannot read the saved figures directly", (await q("bob", "select * from public.cost_month_closures")).length, 0);
check("admins can; another group's admin cannot", [(await q("alice", "select count(*)::int n from public.cost_month_closures"))[0].n, (await q("eve", "select count(*)::int n from public.cost_month_closures"))[0].n], [1, 0]);
check("nobody writes the table directly", [(await q("alice", "update public.cost_month_closures set note = 'x' returning id")).length, (await q("alice", "delete from public.cost_month_closures returning id")).length, (await q("alice", "insert into public.cost_month_closures (group_id, month, snapshot, closed_by) values ($1,'2026-08-01','{}',$2)", [G1, U.alice])).thrown?.includes("row-level security") ?? false], [0, 0, true]);
check("the internal live calculation is not callable", (await rpc("alice", "cost_statement_live", G1, SEP)).thrown?.includes("permission denied") ?? false, true);

// After closing: a late flight does not change the closed figures; the admin is warned.
await put("bob", { ...day("2026-09-20", 9, 30), captainName: "Bob" });   // 0.5 h = 3250
s = await stmt("alice", SEP);
check("a flight logged later does not change a closed month", figures(s), septBefore);
check("...but the admin is shown what has changed since closing", s.drift.map((d) => [d.name, d.closed_pence, d.now_pence, d.closed_tenths, d.now_tenths]), [["Bob", 21750, 25000, 15, 20]]);
check("...a member is not shown the warning", (await stmt("bob", SEP)).drift, []);
// New rates for September do not change it either (but show as a difference).
await rate("alice", SEP, 99999, 99999);
s = await stmt("alice", SEP);
check("new rates for a closed month leave the saved figures alone", figures(s), septBefore);
check("...and show up as a difference for everyone", s.drift.length, 4);
await rate("alice", SEP, 12000, 6500);
check("set back, only the late flight is left as a difference", (await stmt("alice", SEP)).drift.map((d) => d.name), ["Bob"]);
// Expenses: not into, and not out of, a closed month.
check("an expense cannot be added to a closed month", result(await expense("alice", "bob", "2026-09-10", 1500)), "month_closed");
await db.exec("reset role");
const sepExpense = (await db.query("select id from public.cost_expenses where incurred_on = '2026-09-05'")).rows[0].id;
check("...nor voided in one", result(await rpc("alice", "void_cost_expense", sepExpense, "wrong amount")), "month_closed");
check("an expense in an open month is fine", result(await expense("alice", "bob", "2026-10-02", 1500)), "ok");

// Reopening, with a reason.
check("a member cannot reopen", result(await closure("bob", "reopen_cost_month", SEP, "please")), "not_allowed");
check("another group's admin cannot", result(await rpc("eve", "reopen_cost_month", G1, SEP, "not mine")), "not_allowed");
check("a reason is required", result(await closure("alice", "reopen_cost_month", SEP, "  ")), "reason_required");
check("the reason has a limit", result(await closure("alice", "reopen_cost_month", SEP, "x".repeat(301))), "reason_too_long");
check("an open month cannot be reopened", result(await closure("alice", "reopen_cost_month", "2026-08-01", "nothing to reopen")), "not_closed");
check("an admin reopens September", result(await closure("alice", "reopen_cost_month", SEP, "late flight on the 20th")), "ok");
check("it cannot be reopened twice", result(await closure("alice", "reopen_cost_month", SEP, "again")), "not_closed");
s = await stmt("alice", SEP);
check("a reopened month is live again, with the late flight in it", [s.closed, s.can_close, s.drift, member(s, "Bob").hours_tenths, member(s, "Bob").total_pence], [null, true, [], 20, 12000 + 13000]);
check("an expense can be added to it again", result(await expense("alice", "bob", "2026-09-10", 1500)), "ok");
check("it can be closed again", result(await closure("alice", "close_cost_month", SEP, "second time")), "ok");
s = await stmt("alice", SEP);
check("the new closure has the new figures", [s.closed.note, member(s, "Bob").credit_pence, member(s, "Bob").hours_tenths], ["second time", 1500, 20]);
await db.exec("reset role");
check("the first closure stays on record, reopened, with the reason", (await db.query("select note, reopen_reason, reopened_at is not null as reopened from public.cost_month_closures where month = '2026-09-01' order by closed_at")).rows, [{ note: "Checked with the group", reopen_reason: "late flight on the 20th", reopened: true }, { note: "second time", reopen_reason: null, reopened: false }]);

// -------------------------------------------- joining and leaving
await db.exec("reset role");
await db.query("update public.group_members set created_at = '2027-05-20T12:00:00Z' where user_id = $1", [U.cara]);
s = await stmt("alice", "2027-04-01");
check("someone who joins in May was not a member in April", s.members.map((m) => m.name), ["Alice", "Bob"]);
s = await stmt("alice", "2027-05-01");
check("...but pays a full share for May, the month they joined", s.members.map((m) => m.name), ["Alice", "Bob", "Cara"]);
await db.exec("reset role");
await db.query("update public.group_members set removed_at = '2027-07-10T12:00:00Z' where user_id = $1", [U.bob]);
check("someone removed in July still pays July's share", (await stmt("alice", "2027-07-01")).members.map((m) => m.name), ["Alice", "Bob", "Cara"]);
check("...but not August's", (await stmt("alice", "2027-08-01")).members.map((m) => m.name), ["Alice", "Cara"]);
await db.exec("reset role");
await db.query("update public.group_members set removed_at = null where user_id = $1", [U.bob]);

// ---------------------------------------- UK month boundaries
await db.exec("reset role");
await rate("alice", "2027-09-01", 100, 6000);
// 23:30 UTC on 31 Aug 2027 is 00:30 BST on 1 Sep: the flight is in September (UK).
await put("bob", { off: "2027-08-31T23:30:00Z", up: "2027-08-31T23:40:00Z", down: "2027-09-01T00:20:00Z", on: "2027-09-01T00:30:00Z", captainName: "Bob" });
check("a flight just after UK midnight belongs to the next UK month", [(await stmt("alice", "2027-08-01")).hours_tenths, (await stmt("alice", "2027-09-01")).hours_tenths], [0, 10]);

// ------------------------------------------ the TypeScript twin, 200 random months
let seed = 20261007;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (n) => Math.floor(rnd() * n);
const names = ["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7"];
let mismatches = 0;
let scenarios = 0;
const coverage = { withFlights: 0, withOwnRates: 0, withEmptyOwnPart: 0, withExpenses: 0, withNonMemberCharged: 0, withVoids: 0, withoutRates: 0, negativeTotals: 0, guestFlights: 0, nonMemberPaid: 0 };
const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

for (let i = 0; i < 200; i++) {
  const gid = `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`;
  await db.exec("reset role");
  await db.query("insert into public.groups (id, slug, name, aircraft_registration) values ($1, $2, 'Random', 'G-RAND')", [gid, `rand-${i}`]);
  const month = 3 + pick(8); // March..October 2026
  const start = isoDate(2026, month, 1);
  const end = isoDate(2026, month + 1, 1);

  // members: 2-6 people, the first an active admin
  const count = 2 + pick(5);
  const chosen = [...names].sort(() => rnd() - 0.5).slice(0, count);
  const people = chosen.map((n, idx) => {
    const joinedDay = pick(3) === 0 ? isoDate(2026, month, 1 + pick(27)) : isoDate(2025, 1 + pick(12), 1 + pick(27));
    const joinsAfter = idx > 0 && pick(8) === 0 ? isoDate(2026, month + 1, 3) : joinedDay; // a few join after the month
    const removedDay = idx > 0 && pick(4) === 0 ? isoDate(2026, 1 + pick(10), 1 + pick(27)) : null;
    return { name: n, display: `P-${n}`, role: idx === 0 ? "admin" : "member", created: joinsAfter, removed: idx === 0 ? null : removedDay };
  });
  for (const p of people) {
    await db.query("insert into public.group_members (group_id,user_id,role,display_name,created_at,removed_at) values ($1,$2,$3,$4,$5,$6)",
      [gid, U[p.name], p.role, p.display, `${p.created}T12:00:00Z`, p.removed ? `${p.removed}T12:00:00Z` : null]);
  }

  const hourly = pick(4) === 0 ? 6500 + pick(40) : pick(12000);
  const fee = pick(30000);
  const hasRates = pick(5) !== 0;
  if (hasRates) await db.query("insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,$2,$3,$4,$5)", [gid, isoDate(2026, 1 + pick(month), 1), fee, hourly, U[people[0].name]]);
  // the rate row's month may be after `month` only if pick(month)+1 > month: never (1..month)
  const rateRow = hasRates ? (await db.query("select monthly_fee_pence f, hourly_rate_pence r from public.cost_rates where group_id = $1", [gid])).rows[0] : null;

  // Members' own rates: some people get one or two rows, some with an empty part.
  const ownRows = [];
  let stamp = 0;
  for (const p of people) {
    if (pick(3) !== 0) continue;
    for (let k = 0, n = 1 + pick(2); k < n; k++) {
      const row = {
        user: p, effective: isoDate(2026, 1 + pick(month), 1),
        fee: pick(3) === 0 ? null : pick(3) === 0 ? 0 : pick(30000),
        hourly: pick(3) === 0 ? null : pick(3) === 0 ? 0 : pick(15000),
        created: new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++)).toISOString(),
      };
      ownRows.push(row);
      await db.query("insert into public.cost_rates (group_id, user_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [gid, U[p.name], row.effective, row.fee, row.hourly, U[people[0].name], row.created]);
    }
  }
  // the newest row starting on or before the month wins, per person
  const ownRates = people.flatMap((p) => {
    const rows = ownRows.filter((r) => r.user === p && r.effective <= start).sort((x, y) => (y.effective + y.created).localeCompare(x.effective + x.created));
    return rows.length ? [{ userId: U[p.name], feePence: rows[0].fee, hourlyPence: rows[0].hourly }] : [];
  });

  // Expenses paid by anyone in the group (even someone who has left), some voided,
  // some just outside the month.
  const expenseRows = [];
  for (let k = 0, n = pick(4); k < n; k++) {
    const payer = people[pick(people.length)];
    const outside = pick(5) === 0;
    const voided = pick(5) === 0;
    const e = { id: `e${i}-${k}`, date: outside ? isoDate(2026, month + 1, 1) : isoDate(2026, month, 1 + pick(28)), pence: 1 + pick(60000), payer, voided, outside };
    await db.query("insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by, voided_at, voided_by, void_reason) values ($1,$2,$3,'x',$4,$5,$6,$7,$8)",
      [gid, U[payer.name], e.date, e.pence, U[people[0].name], voided ? "2026-12-01T00:00:00Z" : null, voided ? U[people[0].name] : null, voided ? "test" : null]);
    expenseRows.push(e);
  }
  const countedExpenses = expenseRows.filter((e) => !e.voided && !e.outside);

  const flights = [];
  for (let k = 0, n = pick(9); k < n; k++) {
    const d = 1 + pick(28);
    const startHour = 6 + k; // distinct hours on the same day never overlap (max block 5 h < 1 h gap? use own day per flight instead)
    const block = 30 + pick(271);
    const dayKey = isoDate(2026, month, d);
    const offIso = `${dayKey}T${String(8 + (k % 2) * 8).padStart(2, "0")}:00:00Z`;
    void startHour;
    const off = new Date(offIso);
    const at = (m) => new Date(off.getTime() + m * 60000).toISOString();
    const guest = pick(4) === 0;
    const actor = pick(people.length);
    const captain = guest ? null : pick(people.length);
    const voided = pick(5) === 0;
    const logger = people[actor];
    flights.push({
      id: `f${i}-${k}`, dayKey, off: at(0), up: at(10), down: at(block - 10), on: at(block), block,
      captain: captain === null ? null : people[captain], logger, voided,
    });
  }
  // flights must not overlap: drop later ones that collide
  const ok = [];
  for (const f of flights) {
    const a = Date.parse(f.off);
    const b = Date.parse(f.on);
    if (ok.every((g) => b <= Date.parse(g.off) || a >= Date.parse(g.on))) ok.push(f);
  }
  for (const f of ok) {
    await db.query(
      `insert into public.flight_entries (group_id, flight_date, from_place, to_place, flight_category, captain_id, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, created_by, voided_at, voided_by, void_reason)
       values ($1,$2,'A','B','PV',$3,$4,1,1,1,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [gid, f.dayKey, f.captain ? U[f.captain.name] : null, f.captain ? f.captain.display : "Guest", f.off, f.up, f.down, f.on, U[f.logger.name],
        f.voided ? "2026-12-01T00:00:00Z" : null, f.voided ? U[people[0].name] : null, f.voided ? "test" : null],
    );
  }

  // Expected, by the TypeScript twin
  const monthMembers = people.filter((p) => p.created < end && (p.removed === null || p.removed >= start));
  const input = (viewer) => ({
    month: start,
    rates: rateRow ? { feePence: rateRow.f, hourlyPence: rateRow.r, missing: false } : { feePence: 0, hourlyPence: 0, missing: true },
    ownRates,
    members: monthMembers.map((p) => ({ userId: U[p.name], name: p.display })),
    flights: ok.filter((f) => !f.voided).map((f) => {
      const charged = f.captain ?? f.logger;
      return { id: f.id, date: f.dayKey, from: "A", to: "B", chargedTo: U[charged.name], chargedName: charged.display, tenths: Number(minutesToDeci(f.block) * 10), order: f.off };
    }),
    expenses: countedExpenses.map((e) => ({ id: e.id, date: e.date, description: "x", paidBy: U[e.payer.name], paidByName: e.payer.display, pence: e.pence })),
    viewer,
  });

  // viewers: the admin, and one active member
  const active = people.filter((p) => p.removed === null || p.removed >= `${isoDate(2026, 12, 31)}`); // active today = not removed at all
  const viewers = [{ who: people[0], isAdmin: true }];
  const plain = people.slice(1).find((p) => p.removed === null);
  if (plain) viewers.push({ who: plain, isAdmin: false });
  void active;

  for (const v of viewers) {
    // flight_date for direct inserts is the date key, so ids differ: map SQL flights back by position
    const sql = await rpc(v.who.name, "cost_statement", gid, start);
    const want = computeStatement(input({ userId: U[v.who.name], isAdmin: v.isAdmin }));
    scenarios++;
    if (v.isAdmin) {
      if (want.flights.length > 0) coverage.withFlights++;
      if (want.members.some((m) => m.custom_rates)) coverage.withOwnRates++;
      if (ownRates.some((r) => r.feePence === null || r.hourlyPence === null)) coverage.withEmptyOwnPart++;
      if (want.credits_pence > 0) coverage.withExpenses++;
      if (want.members.some((m) => m.total_pence < 0)) coverage.negativeTotals++;
      if (want.members.some((m) => !m.is_member && m.credit_pence > 0)) coverage.nonMemberPaid++;
      if (want.members.some((m) => !m.is_member)) coverage.withNonMemberCharged++;
      if (ok.some((f) => f.voided)) coverage.withVoids++;
      if (want.rates.missing) coverage.withoutRates++;
      if (ok.some((f) => !f.captain && !f.voided)) coverage.guestFlights++;
    }

    const norm = (st) => ({
      result: st.result, month: st.month, isAdmin: st.is_admin, rates: [st.rates.fee_pence, st.rates.hourly_pence, st.rates.missing], credits: st.credits_pence, hours: st.hours_tenths,
      members: Object.fromEntries(st.members.map((m) => [m.user_id, [m.name, m.is_member, m.flights, m.hours_tenths, m.fee_pence, m.hourly_rate_pence, m.custom_rates, m.fixed_pence, m.hourly_pence, m.credit_pence, m.total_pence]])),
      expenses: st.expenses.map((e) => [e.user_id, e.pence, e.date.slice(0, 10)]).sort(),
      flights: st.flights.map((f) => [f.user_id, f.hours_tenths, f.pence, f.date.slice(0, 10)]).sort(),
    });
    const a = JSON.stringify(norm(sql));
    const b = JSON.stringify(norm(want));
    if (a !== b) {
      mismatches++;
      if (mismatches <= 3) console.log(`MISMATCH scenario ${i} viewer ${v.who.name} (admin ${v.isAdmin})\n  sql  ${a}\n  twin ${b}`);
    }
  }
}
check(`the database and the TypeScript twin agree on ${scenarios} random statements`, mismatches, 0);
console.log("      what the random months covered:", JSON.stringify(coverage));
check("the random months really exercised the tricky cases", [
  coverage.withFlights >= 100, coverage.withOwnRates >= 40, coverage.withEmptyOwnPart >= 20, coverage.withExpenses >= 60,
  coverage.withNonMemberCharged >= 5, coverage.withVoids >= 30, coverage.withoutRates >= 10,
  coverage.negativeTotals >= 5, coverage.guestFlights >= 30, coverage.nonMemberPaid >= 3,
], [true, true, true, true, true, true, true, true, true, true]);

h.finish();
