// Cost statement database test: the fixed share, the hourly charge and the fuel
// split worked out by hand, every rule (rates by month, guests, joining and
// leaving, voids), who may see what, and finally hundreds of random months
// compared with the TypeScript twin (src/lib/costs.ts) so the two cannot drift.
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
const fuel = (user, date, pence, o = {}) => rpc(user, "add_cost_item", o.group ?? G1, date, o.category ?? "fuel", o.description ?? "Fuel", pence);
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

// ---------------------------------------------------------- cost items
check("a member cannot add a cost", result(await fuel("bob", "2026-10-05", 10000)), "not_allowed");
check("category must be known", result(await fuel("alice", "2026-10-05", 10000, { category: "hangar" })), "category_invalid");
check("description required", result(await fuel("alice", "2026-10-05", 10000, { description: "  " })), "description_required");
check("description length limited", result(await fuel("alice", "2026-10-05", 10000, { description: "x".repeat(121) })), "description_too_long");
check("amount must be positive", result(await fuel("alice", "2026-10-05", 0)), "amount_invalid");
check("amount must not be absurd", result(await fuel("alice", "2026-10-05", 10000001)), "amount_invalid");
check("date must be sensible (not far future)", result(await fuel("alice", "2999-01-01", 100)), "date_invalid");
check("date must be sensible (not ancient)", result(await fuel("alice", "1999-12-31", 100)), "date_invalid");
check("an admin adds fuel", result(await fuel("alice", "2026-10-05", 6000, { description: "Fuel, self-serve" })), "ok");
check("and another cost shared by hours", result(await fuel("alice", "2026-10-06", 4001, { category: "other", description: "Landing fees" })), "ok");
await db.exec("reset role");
const itemId = (await db.query("select id from public.cost_items where description = 'Landing fees'")).rows[0].id;
check("members cannot read the individual items", (await q("bob", "select * from public.cost_items")).length, 0);
check("admins can", (await q("alice", "select count(*)::int n from public.cost_items"))[0].n, 2);
check("another group's admin cannot", (await q("eve", "select * from public.cost_items")).length, 0);
check("nobody can edit an item", (await q("alice", "update public.cost_items set amount_pence = 1 returning id")).length, 0);
check("nobody can delete an item", (await q("alice", "delete from public.cost_items returning id")).length, 0);
check("a member cannot void", result(await rpc("bob", "void_cost_item", itemId, "mistake")), "not_allowed");
check("a reason is required", result(await rpc("alice", "void_cost_item", itemId, "  ")), "reason_required");
check("unknown item", result(await rpc("alice", "void_cost_item", "00000000-0000-0000-0000-000000000000", "mistake")), "not_found");
check("another group's admin cannot void", result(await rpc("eve", "void_cost_item", itemId, "not mine")), "not_allowed");

// ------------------------------------------------ a month worked out by hand
// October 2026: fee 120.00, rate 65.00/h. Fuel 60.00 + 40.01 = 100.01 (10001p).
// Bob flew 90 block minutes (1.5 h = 15 tenths), Cara 100 (1.7 h = 17 tenths).
await flight("bob", day("2026-10-06", 9, 90));
await flight("cara", day("2026-10-07", 9, 100));
let s = await stmt("alice");
check("the statement succeeds for an admin", [s.result, s.is_admin, s.month], ["ok", true, "2026-10-01"]);
check("the rates in force are April's (the latest before October)", [s.rates.fee_pence, s.rates.hourly_pence, s.rates.missing], [12000, 6500, false]);
check("the month's totals: fuel and hours", [s.fuel_pence, s.hours_tenths], [10001, 32]);
check("members are Alice, Bob, Cara (Dan left in September)", s.members.map((m) => m.name), ["Alice", "Bob", "Cara"]);
check("everyone pays the fixed share", s.members.map((m) => m.fixed_pence), [12000, 12000, 12000]);
check("hourly: 15 tenths x 6500 / 10 = 9750 and 17 tenths = 11050", [member(s, "Alice").hourly_pence, member(s, "Bob").hourly_pence, member(s, "Cara").hourly_pence], [0, 9750, 11050]);
check("fuel by hours: 10001 x 15/32 = 4687.97 -> 4688 (leftover penny to the biggest remainder), Cara 5313", [member(s, "Alice").fuel_pence, member(s, "Bob").fuel_pence, member(s, "Cara").fuel_pence], [0, 4688, 5313]);
check("the fuel shares add up to the bill exactly", s.members.reduce((t, m) => t + m.fuel_pence, 0), 10001);
check("totals", s.members.map((m) => m.total_pence), [12000, 12000 + 9750 + 4688, 12000 + 11050 + 5313]);
check("flights listed with their charge", s.flights.map((f) => [f.user_id === U.bob ? "bob" : "cara", f.hours_tenths, f.pence]), [["bob", 15, 9750], ["cara", 17, 11050]]);

// ------------------------------------------------------- who sees what
s = await stmt("bob");
check("a member sees only their own statement and flights", [s.is_admin, s.members.map((m) => m.name), s.flights.map((f) => f.hours_tenths)], [false, ["Bob"], [15]]);
check("...but the month's totals they need to understand it", [s.fuel_pence, s.hours_tenths, s.rates.hourly_pence], [10001, 32, 6500]);
check("...and their own numbers are the same as the admin sees", member(s, "Bob").total_pence, 12000 + 9750 + 4688);
s = await stmt("alice", "2026-10-01", G2);
check("an admin of another group has no access", s.result, "not_allowed");
check("a removed member has no access", (await stmt("dan")).result, "not_allowed");
check("anonymous has no access", (await rpc(null, "cost_statement", G1, "2026-10-01")).thrown?.includes("permission denied") ?? false, true);
check("a bad month is refused", (await stmt("alice", "1990-01-01")).result, "month_invalid");
check("the internal flight helper is not callable", (await rpc("alice", "cost_month_flights", G1, "2026-10-01", "2026-11-01", 100)).thrown !== undefined, true);

// -------------------------------------------------- voids stop counting
await rpc("alice", "void_cost_item", itemId, "entered twice");
s = await stmt("alice");
check("a voided cost leaves the fuel total", s.fuel_pence, 6000);
await db.exec("reset role");
const bobFlight = (await db.query("select id from public.flight_entries where captain_name = 'Bob'")).rows[0].id;
await rpc("alice", "void_flight_entry", bobFlight, "wrong day");
s = await stmt("alice");
check("a voided flight leaves the hours and the charge", [s.hours_tenths, member(s, "Bob").hourly_pence, member(s, "Bob").fuel_pence, member(s, "Cara").fuel_pence], [17, 0, 0, 6000]);

// ---------------------------------------------------- guests and loggers
await put("bob", { ...day("2026-10-12", 9, 60), captain: null, captainName: "Guest Pilot" });
s = await stmt("alice");
check("a guest captain's flight is charged to the member who logged it", [member(s, "Bob").hours_tenths, member(s, "Bob").hourly_pence], [10, 6500]);
await put("alice", { ...day("2026-10-13", 9, 60), captain: U.cara, captainName: "Cara" });
s = await stmt("alice");
check("a flight logged by one member for another member is charged to the captain", [member(s, "Alice").hours_tenths, member(s, "Cara").hours_tenths], [0, 17 + 10]);

// -------------------------------------------- rates change from a month
check("a new rate from November", result(await rate("alice", "2026-11-01", 15000, 7000)), "ok");
await put("bob", { ...day("2026-11-03", 9, 60), captainName: "Bob" });
s = await stmt("alice", "2026-11-15");
check("November uses the new rates", [s.rates.fee_pence, s.rates.hourly_pence, member(s, "Bob").hourly_pence, member(s, "Bob").fixed_pence], [15000, 7000, 7000, 15000]);
s = await stmt("alice", "2026-10-15");
check("October is unchanged by the later rate (any day in the month works)", [s.rates.fee_pence, s.rates.hourly_pence, member(s, "Cara").hourly_pence], [12000, 6500, 10 * 650 + 17 * 650]);
check("a later correction for the same month replaces the earlier one", result(await rate("alice", "2026-11-01", 15500, 7000)), "ok");
check("...the newest row for a month wins", (await stmt("alice", "2026-11-01")).rates.fee_pence, 15500);
s = await stmt("alice", "2026-02-01");
check("February (before April's rates) uses January's", [s.rates.fee_pence, s.rates.hourly_pence], [11000, 6000]);
s = await stmt("alice", "2025-06-01");
check("a month before any rates is flagged, with zero rates", [s.rates.missing, s.rates.fee_pence, s.rates.hourly_pence], [true, 0, 0]);

// ------------------------------------------------ odd pence per flight
await rate("alice", "2027-01-01", 0, 6505);
await put("bob", { ...day("2027-01-05", 9, 6), captainName: "Bob" });   // 6 min = 0.1 h = 1 tenth -> 650.5 p -> 651
await put("bob", { ...day("2027-01-06", 9, 12), captainName: "Bob" });  // 0.2 h -> 2 tenths -> 1301 p
s = await stmt("alice", "2027-01-01");
check("each flight's charge is rounded half up to a whole penny", s.flights.map((f) => f.pence), [651, 1301]);
check("and the member's hourly total is the sum of those, so the lines add up", member(s, "Bob").hourly_pence, 651 + 1301);

// -------------------------------------------- no flights, but fuel
await db.exec("reset role");
await db.exec("delete from public.cost_items");
// (inserted directly: the real rule refuses a cost dated more than a day ahead)
await db.query("insert into public.cost_items (group_id, incurred_on, category, description, amount_pence, created_by) values ($1,'2027-03-02','fuel','x',1000,$2), ($1,'2027-03-03','fuel','y',1,$2)", [G1, U.alice]);
s = await stmt("alice", "2027-03-01");
check("a month with fuel but no flights splits it equally, to the penny", [s.hours_tenths, s.members.map((m) => m.fuel_pence).sort((a, b) => b - a), s.members.reduce((t, m) => t + m.fuel_pence, 0)], [0, [334, 334, 333], 1001]);

// -------------------------------------------- joining and leaving
await db.exec("reset role");
await db.exec("delete from public.cost_items");
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
const coverage = { withFlights: 0, withFuel: 0, withLeftoverPence: 0, withNonMemberCharged: 0, withVoids: 0, withoutRates: 0, noFlightsButFuel: 0, guestFlights: 0 };
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

  let fuelTotal = 0;
  for (let k = 0, n = pick(5); k < n; k++) {
    const amount = 1 + pick(80000);
    const voided = pick(4) === 0;
    await db.query("insert into public.cost_items (group_id, incurred_on, category, description, amount_pence, created_by, voided_at, voided_by, void_reason) values ($1,$2,$3,'x',$4,$5,$6,$7,$8)",
      [gid, isoDate(2026, month, 1 + pick(28)), pick(2) ? "fuel" : "other", amount, U[people[0].name], voided ? "2026-12-01T00:00:00Z" : null, voided ? U[people[0].name] : null, voided ? "test" : null]);
    if (!voided) fuelTotal += amount;
  }
  // a cost just outside the month must not count
  await db.query("insert into public.cost_items (group_id, incurred_on, category, description, amount_pence, created_by) values ($1,$2,'fuel','outside',777,$3)", [gid, isoDate(2026, month + 1, 1), U[people[0].name]]);

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
    fuelPence: fuelTotal,
    members: monthMembers.map((p) => ({ userId: U[p.name], name: p.display })),
    flights: ok.filter((f) => !f.voided).map((f) => {
      const charged = f.captain ?? f.logger;
      return { id: f.id, date: f.dayKey, from: "A", to: "B", chargedTo: U[charged.name], chargedName: charged.display, tenths: Number(minutesToDeci(f.block) * 10), order: f.off };
    }),
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
      if (want.fuel_pence > 0) coverage.withFuel++;
      if (want.hours_tenths > 0 && want.members.some((m) => (want.fuel_pence * m.hours_tenths) % want.hours_tenths !== 0)) coverage.withLeftoverPence++;
      if (want.members.some((m) => !m.is_member)) coverage.withNonMemberCharged++;
      if (ok.some((f) => f.voided)) coverage.withVoids++;
      if (want.rates.missing) coverage.withoutRates++;
      if (want.hours_tenths === 0 && want.fuel_pence > 0) coverage.noFlightsButFuel++;
      if (ok.some((f) => !f.captain && !f.voided)) coverage.guestFlights++;
    }

    const norm = (st) => ({
      result: st.result, month: st.month, isAdmin: st.is_admin, rates: [st.rates.fee_pence, st.rates.hourly_pence, st.rates.missing], fuel: st.fuel_pence, hours: st.hours_tenths,
      members: Object.fromEntries(st.members.map((m) => [m.user_id, [m.is_member, m.flights, m.hours_tenths, m.fixed_pence, m.hourly_pence, m.fuel_pence, m.total_pence]])),
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
  coverage.withFlights >= 100, coverage.withFuel >= 100, coverage.withLeftoverPence >= 30,
  coverage.withNonMemberCharged >= 5, coverage.withVoids >= 30, coverage.withoutRates >= 10,
  coverage.noFlightsButFuel >= 5, coverage.guestFlights >= 30,
], [true, true, true, true, true, true, true, true]);

h.finish();
