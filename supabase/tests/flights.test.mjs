// Flight log database test: the calculations (block/flight time, decimal
// hours, airframe totals, hours to the next check), the validation rules, the
// overlap guard, voiding, and who may see or change what.
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve");
console.log("all migrations applied");

// Group 1: alice admin, bob and cara members, dan removed. Group 2: eve admin.
await db.exec(`
  insert into public.groups (id, slug, name, aircraft_registration, hours_to_next_check)
  values ('11111111-1111-1111-1111-111111111111','g1','One','G-ONE', 40),
         ('22222222-2222-2222-2222-222222222222','g2','Two','G-TWO', 40);`);
const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name,removed_at) values
    ($1,$2,'admin','Alice',null), ($1,$3,'member','Bob',null), ($1,$4,'member','Cara',null),
    ($1,$5,'member','Dan', now()), ($6,$7,'admin','Eve',null)`,
  [G1, U.alice, U.bob, U.cara, U.dan, G2, U.eve],
);

const t = (hhmm, day = "2026-10-04", off = "+01:00") => `${day}T${hhmm}:00${off}`;

// add(user, overrides): one valid entry unless a field is overridden.
const add = (user, o = {}) => {
  const e = {
    group: G1, from: "eglm", to: "eglm", category: "PV",
    captainId: U[user], captainName: null,
    fuelL: 24, fuelR: 23.5, oil: 7,
    off: t("09:10"), up: t("09:18"), down: t("10:30"), on: t("10:40"),
    defects: null, ...o,
  };
  return rpc(user, "add_flight_entry", e.group, e.from, e.to, e.category, e.captainId, e.captainName,
    e.fuelL, e.fuelR, e.oil, e.off, e.up, e.down, e.on, e.defects);
};
const group = async (id = G1) => (await db.query("select airframe_hours_baseline b, airframe_total_hours t, next_check_at_hours c, hours_to_next_check r from public.groups where id=$1", [id])).rows[0];
const num = (v) => (v === null ? null : Number(v));

// --- the paper conversion table ----------------------------------------
const table = { 0: 0, 5: 0.1, 10: 0.2, 15: 0.3, 20: 0.3, 25: 0.4, 30: 0.5, 35: 0.6, 40: 0.7, 45: 0.8, 50: 0.8, 55: 0.9, 60: 1.0, 72: 1.2, 90: 1.5, 96: 1.6 };
for (const [mins, want] of Object.entries(table)) {
  check(`${mins} min = ${want} h`, num((await db.query("select public.minutes_to_deci($1) d", [mins])).rows[0].d), want);
}

// --- a valid entry and its calculated columns --------------------------
check("member adds an entry", result(await add("bob")), "ok");
await db.exec("reset role");
const e1 = (await db.query("select * from public.flight_entries where group_id=$1", [G1])).rows[0];
check("places upper-cased", [e1.from_place, e1.to_place], ["EGLM", "EGLM"]);
check("captain name comes from the membership", e1.captain_name, "Bob");
check("block 90 min = 1.5 h", [e1.block_minutes, num(e1.block_deci)], [90, 1.5]);
check("flight 72 min = 1.2 h", [e1.flight_minutes, num(e1.flight_deci)], [72, 1.2]);
check("created_by is the person who typed it", e1.created_by, U.bob);
check("flight_date is the UK date", e1.flight_date.toISOString().slice(0, 10), "2026-10-04");

check("UK date across midnight in BST (23:30Z is 00:30 next day)",
  result(await add("bob", { off: "2026-10-04T23:30:00Z", up: "2026-10-04T23:40:00Z", down: "2026-10-05T00:10:00Z", on: "2026-10-05T00:20:00Z" })), "ok");
await db.exec("reset role");
check("...is dated the 5th", (await db.query("select flight_date::text d from public.flight_entries where brakes_off='2026-10-04T23:30:00Z'")).rows[0].d, "2026-10-05");
check("winter: 23:30Z is still the same UK day",
  result(await add("bob", { off: "2026-01-14T23:30:00Z", up: "2026-01-14T23:40:00Z", down: "2026-01-15T00:10:00Z", on: "2026-01-15T00:20:00Z" })), "ok");
await db.exec("reset role");
check("...dated the 1st", (await db.query("select flight_date::text d from public.flight_entries where brakes_off='2026-01-14T23:30:00Z'")).rows[0].d, "2026-01-14");
await db.exec(`delete from public.flight_entries where brakes_off > '2026-10-04T12:00:00Z'`); // keep only e1 for what follows

// --- who may add --------------------------------------------------------
check("removed member refused", result(await add("dan", { captainId: U.dan })), "not_allowed");
check("member of another group refused", result(await add("eve")), "not_allowed");
check("anonymous refused", (await rpc(null, "add_flight_entry", G1, "a", "b", "PV", null, "x", 1, 1, 1, t("11:00"), t("11:05"), t("11:30"), t("11:35"), null)).thrown?.includes("permission denied") ?? false, true);

// --- captain ------------------------------------------------------------
check("a member may log a flight for another member", result(await add("bob", { captainId: U.cara, off: t("12:00"), up: t("12:05"), down: t("12:50"), on: t("12:55") })), "ok");
await db.exec("reset role");
check("...captain is Cara, entered by Bob", (await db.query("select captain_name, created_by=$1 as by_bob from public.flight_entries where brakes_off=$2", [U.bob, t("12:00")])).rows[0], { captain_name: "Cara", by_bob: true });
check("captain who is not a member refused", result(await add("bob", { captainId: U.dan, off: t("14:00"), up: t("14:05"), down: t("14:50"), on: t("14:55") })), "captain_invalid");
check("captain from another group refused", result(await add("bob", { captainId: U.eve, off: t("14:00"), up: t("14:05"), down: t("14:50"), on: t("14:55") })), "captain_invalid");
check("guest captain by name", result(await add("bob", { captainId: null, captainName: "  Guest Pilot ", off: t("15:00"), up: t("15:05"), down: t("15:50"), on: t("15:55") })), "ok");
await db.exec("reset role");
check("...name trimmed, no member id", (await db.query("select captain_name, captain_id from public.flight_entries where brakes_off=$1", [t("15:00")])).rows[0], { captain_name: "Guest Pilot", captain_id: null });
check("no captain at all refused", result(await add("bob", { captainId: null, captainName: "  ", off: t("16:00"), up: t("16:05"), down: t("16:50"), on: t("16:55") })), "captain_required");

// --- validation ---------------------------------------------------------
const later = { off: t("18:00"), up: t("18:05"), down: t("18:50"), on: t("18:55") };
check("empty from refused", result(await add("bob", { ...later, from: "  " })), "place_required");
check("empty to refused", result(await add("bob", { ...later, to: "" })), "place_required");
check("overlong place refused", result(await add("bob", { ...later, to: "x".repeat(41) })), "place_too_long");
check("bad category refused", result(await add("bob", { ...later, category: "XX" })), "category_invalid");
for (const c of ["PV", "TG", "PT"]) check(`category ${c} accepted`, result(await add("bob", { ...later, category: c, off: t(`2${["PV","TG","PT"].indexOf(c)}:00`), up: t(`2${["PV","TG","PT"].indexOf(c)}:05`), down: t(`2${["PV","TG","PT"].indexOf(c)}:30`), on: t(`2${["PV","TG","PT"].indexOf(c)}:35`) })), "ok");
check("negative fuel refused", result(await add("bob", { ...later, fuelL: -1 })), "fuel_invalid");
check("fuel over 100 refused", result(await add("bob", { ...later, fuelR: 101 })), "fuel_invalid");
check("missing fuel refused", result(await add("bob", { ...later, fuelL: null })), "fuel_invalid");
check("oil over 20 refused", result(await add("bob", { ...later, oil: 21 })), "oil_invalid");
check("missing oil refused", result(await add("bob", { ...later, oil: null })), "oil_invalid");
check("airborne before brakes off refused", result(await add("bob", { ...later, up: t("17:59") })), "times_order");
check("landed before airborne refused", result(await add("bob", { ...later, down: t("18:04") })), "times_order");
check("brakes on before landed refused", result(await add("bob", { ...later, on: t("18:49") })), "times_order");
check("zero-length block refused", result(await add("bob", { off: t("18:00"), up: t("18:00"), down: t("18:00"), on: t("18:00") })), "times_order");
check("missing time refused", result(await add("bob", { ...later, up: null })), "times_order");
check("over 16 hours refused", result(await add("bob", { off: t("00:00", "2026-09-01"), up: t("00:10", "2026-09-01"), down: t("17:00", "2026-09-01"), on: t("17:10", "2026-09-01") })), "too_long");
const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
const soon2 = new Date(Date.now() + 4 * 3600e3).toISOString();
check("flight starting 3 hours from now refused", result(await add("bob", { off: soon, up: soon, down: soon2, on: soon2 })), "in_future");
check("over-long defects refused", result(await add("bob", { ...later, defects: "x".repeat(2001) })), "defects_too_long");
check("defects stored trimmed; blank means nil", [result(await add("bob", { ...later, defects: "  Transponder intermittent  " }))], ["ok"]);
await db.exec("reset role");
check("...defect text", (await db.query("select defects from public.flight_entries where brakes_off=$1", [later.off])).rows[0].defects, "Transponder intermittent");
check("blank defects stored as null", result(await add("bob", { off: t("19:00"), up: t("19:05"), down: t("19:50"), on: t("19:55"), defects: "   " })), "ok");
await db.exec("reset role");
check("...null", (await db.query("select defects from public.flight_entries where brakes_off=$1", [t("19:00")])).rows[0].defects, null);

// --- overlap guard ------------------------------------------------------
check("overlapping flight refused", result(await add("cara", { off: t("09:30"), up: t("09:35"), down: t("10:00"), on: t("10:05") })), "overlap");
check("identical entry (double tap) refused", result(await add("bob")), "overlap");
check("touching flight (starts exactly when the other ends) accepted", result(await add("cara", { off: t("10:40"), up: t("10:45"), down: t("11:10"), on: t("11:15") })), "ok");
check("another group is unaffected by the same times", result(await add("eve", { group: G2, captainId: U.eve })), "ok");

// --- totals: nothing set yet -------------------------------------------
await db.exec("reset role");
check("without a baseline, total stays empty and the manual figure is untouched", await group(G1), { b: null, t: null, c: null, r: "40" });

// --- totals: set up by an admin ----------------------------------------
check("member cannot set airframe hours", result(await rpc("bob", "set_airframe_hours", G1, 5870.4, 5892.9)), "not_allowed");
check("anonymous cannot", (await rpc(null, "set_airframe_hours", G1, 1, 2)).thrown?.includes("permission denied") ?? false, true);
check("negative hours refused", result(await rpc("alice", "set_airframe_hours", G1, -1, 5892.9)), "hours_invalid");
check("missing total refused", result(await rpc("alice", "set_airframe_hours", G1, null, 5892.9)), "hours_invalid");
await db.exec("reset role");
const flown = num((await db.query("select sum(flight_deci) s from public.flight_entries where group_id=$1 and voided_at is null", [G1])).rows[0].s);
check("admin sets 'total now' and the check limit", result(await rpc("alice", "set_airframe_hours", G1, 5870.4, 5892.9)), "ok");
await db.exec("reset role");
let g = await group();
check("total is exactly what the admin said, despite earlier entries", num(g.t), 5870.4);
check("baseline backs out the logged flights", Math.round((num(g.b) + flown) * 10) / 10, 5870.4);
check("hours to check = limit - total", num(g.r), 22.5);

check("next flight adds its flight time (1.2 h)", result(await add("bob", { off: t("07:00"), up: t("07:08"), down: t("08:20"), on: t("08:30") })), "ok");
await db.exec("reset role");
g = await group();
check("total after the flight", num(g.t), 5871.6);
check("hours to check after the flight", num(g.r), 21.3);

// --- voiding ------------------------------------------------------------
const voidId = (await db.query("select id from public.flight_entries where brakes_off=$1", [t("07:00")])).rows[0].id;
check("member cannot void", result(await rpc("bob", "void_flight_entry", voidId, "typo")), "not_allowed");
check("admin needs a reason", result(await rpc("alice", "void_flight_entry", voidId, " a ")), "reason_required");
check("admin from another group cannot void", result(await rpc("eve", "void_flight_entry", voidId, "not mine")), "not_allowed");
check("unknown entry", result(await rpc("alice", "void_flight_entry", "00000000-0000-0000-0000-000000000000", "gone")), "not_found");
check("admin voids with a reason", result(await rpc("alice", "void_flight_entry", voidId, "Wrong day, re-entered")), "ok");
await db.exec("reset role");
g = await group();
check("voided flight leaves the totals", [num(g.t), num(g.r)], [5870.4, 22.5]);
check("voided entry is kept, with who/why", (await db.query("select voided_by=$1 as by_alice, void_reason from public.flight_entries where id=$2", [U.alice, voidId])).rows[0], { by_alice: true, void_reason: "Wrong day, re-entered" });
check("cannot void twice", result(await rpc("alice", "void_flight_entry", voidId, "again")), "already_voided");
check("voided time slot can be used again (no overlap)", result(await add("bob", { off: t("07:00"), up: t("07:08"), down: t("08:20"), on: t("08:30") })), "ok");
await db.exec("reset role");
check("total counts the re-entered flight once", num((await group()).t), 5871.6);

// --- re-calibrating with entries present --------------------------------
check("admin re-sets total to 5880.0 and limit 5900", result(await rpc("alice", "set_airframe_hours", G1, 5880, 5900)), "ok");
await db.exec("reset role");
g = await group();
check("total now 5880.0, hours to check 20.0", [num(g.t), num(g.r)], [5880, 20]);
check("a further flight (1.2 h) adds to it", result(await add("bob", { off: t("05:00"), up: t("05:08"), down: t("06:20"), on: t("06:30") })), "ok");
await db.exec("reset role");
check("5881.2 / 18.8", [num((await group()).t), num((await group()).r)], [5881.2, 18.8]);
check("clearing the check limit keeps the baseline, stops deriving", result(await rpc("alice", "set_airframe_hours", G1, 5881.2, null)), "ok");
await db.exec("reset role");
check("hours to check left as last computed", [num((await group()).t), num((await group()).c), num((await group()).r)], [5881.2, null, 18.8]);

// --- the check limit is remembered per entry ------------------------------
await db.exec("reset role");
const limitAt = async (clock) => num((await db.query("select check_limit_hours c from public.flight_entries where group_id=$1 and brakes_off=$2 and voided_at is null", [G1, t(clock)])).rows[0].c);
check("entry logged while the limit was 5892.9 remembers 5892.9", await limitAt("07:00"), 5892.9);
check("entry logged after the limit became 5900 remembers 5900", await limitAt("05:00"), 5900);
check("admin moves the limit to 6000 (as after a check)", result(await rpc("alice", "set_airframe_hours", G1, 5881.2, 6000)), "ok");
check("a new entry gets the new limit", result(await add("bob", { off: t("03:00"), up: t("03:05"), down: t("03:50"), on: t("03:55") })), "ok");
await db.exec("reset role");
check("...while older entries keep what applied then", [await limitAt("07:00"), await limitAt("05:00"), await limitAt("03:00")], [5892.9, 5900, 6000]);
check("entries from before any limit was set stay empty", num((await db.query("select check_limit_hours c from public.flight_entries where group_id=$1 and brakes_off=$2", [G1, t("09:10")])).rows[0].c), null);
check("group 2 has no limit, so its entry has none", (await db.query("select check_limit_hours c from public.flight_entries where group_id=$1 limit 1", [G2])).rows[0].c, null);
check("the snapshot helper is not callable by the app", (await rpc("alice", "flight_entry_snapshot_check_limit")).thrown !== undefined, true);

// --- access -------------------------------------------------------------
check("members see their group's log (incl. voided)", (await q("cara", "select count(*)::int n from public.flight_entries"))[0].n > 0, true);
check("other group's member sees only their own entries", (await q("eve", "select count(*)::int n from public.flight_entries where group_id=$1", [G1]))[0].n, 0);
check("removed member sees nothing", (await q("dan", "select count(*)::int n from public.flight_entries"))[0].n, 0);
check("anonymous sees nothing", (await q(null, "select count(*)::int n from public.flight_entries")).thrown?.includes("permission denied") ?? false, true);
check("member cannot insert directly", (await q("bob", "insert into public.flight_entries (group_id, flight_date, from_place, to_place, flight_category, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, created_by) values ($1, '2026-10-04','A','B','PV','x',1,1,1,'2026-10-04T22:00:00Z','2026-10-04T22:01:00Z','2026-10-04T22:30:00Z','2026-10-04T22:31:00Z',$2)", [G1, U.bob])).thrown?.includes("row-level security") ?? false, true);
check("member cannot edit an entry", (await q("bob", "update public.flight_entries set defects='x' where id=$1 returning id", [voidId])).length, 0);
check("admin cannot edit an entry either", (await q("alice", "update public.flight_entries set defects='x' where id=$1 returning id", [voidId])).length, 0);
check("member cannot delete an entry", (await q("bob", "delete from public.flight_entries where id=$1 returning id", [voidId])).length, 0);
check("admin cannot delete an entry", (await q("alice", "delete from public.flight_entries where id=$1 returning id", [voidId])).length, 0);
check("internal recalc is not callable by the app", (await rpc("alice", "recalc_airframe_hours", G1)).thrown?.includes("permission denied") ?? false, true);

h.finish();
