// Tests for the demo group: the invented data hangs together, the stand-in
// database answers queries the way the real one does, visitor changes follow
// the same rules as the real database, and a doctored cookie cannot break it.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { buildDb, TABLE_COLUMNS, DEMO_MEMBERS } from "./data.ts";
import { createDemoEngine } from "./engine.ts";
import { emptyOverlay, encodeOverlay, decodeOverlay, overlayFits } from "./overlay.ts";

let count = 0;
const eq = (got, want, label) => { assert.deepEqual(got, want, label); count++; };
const yes = (cond, label) => { assert.ok(cond, label); count++; };

const NOW = new Date("2026-10-07T10:00:00Z");

// A throwaway engine whose "cookie" is just a variable.
function engineAt(now = NOW, overlay = emptyOverlay()) {
  const state = { overlay, saved: 0 };
  const engine = createDemoEngine({ now, overlay, persist: (next) => { state.overlay = next; state.saved++; } });
  return { engine, state };
}

// ---------------------------------------------------------------- the data
for (const now of [NOW, new Date("2026-01-15T12:00:00Z"), new Date("2026-07-15T12:00:00Z"), new Date("2026-10-25T12:00:00Z")]) {
  const label = now.toISOString().slice(0, 10);
  const db = buildDb(now, emptyOverlay());

  eq(buildDb(now, emptyOverlay()), db, `${label}: same data every time`);
  eq(db.group_members.length, DEMO_MEMBERS.length, `${label}: four members`);
  for (const table of Object.keys(TABLE_COLUMNS)) {
    for (const row of db[table]) eq(Object.keys(row).sort(), [...TABLE_COLUMNS[table]].sort(), `${label}: ${table} rows have exactly the table's columns`);
  }

  // No two confirmed bookings overlap (the database forbids it).
  const confirmed = db.bookings.filter((b) => b.status === "confirmed").map((b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)]).sort((a, b) => a[0] - b[0]);
  yes(confirmed.every(([s, e], i) => e > s && (i === 0 || confirmed[i - 1][1] <= s)), `${label}: bookings never overlap`);
  yes(db.bookings.filter((b) => b.status === "confirmed" && Date.parse(b.starts_at) > now.getTime()).length >= 4, `${label}: upcoming bookings exist`);
  yes(db.bookings.some((b) => Date.parse(b.ends_at) - Date.parse(b.starts_at) > 2 * 86_400_000 && Date.parse(b.starts_at) > now.getTime()), `${label}: a multi-day trip is coming up`);
  yes(db.bookings.length > 60, `${label}: plenty of history for the reports`);

  // Flights: well-formed, never overlapping, each inside its captain's booking.
  const flights = db.flight_entries;
  yes(flights.length >= 6, `${label}: flights exist`);
  const live = flights.filter((f) => !f.voided_at).map((f) => [Date.parse(f.brakes_off), Date.parse(f.brakes_on)]).sort((a, b) => a[0] - b[0]);
  yes(live.every(([s, e], i) => e > s && (i === 0 || live[i - 1][1] <= s)), `${label}: flights never overlap`);
  yes(flights.every((f) => Date.parse(f.brakes_off) <= Date.parse(f.airborne) && Date.parse(f.airborne) <= Date.parse(f.landed) && Date.parse(f.landed) <= Date.parse(f.brakes_on)), `${label}: flight times in order`);
  yes(flights.every((f) => Date.parse(f.brakes_on) < now.getTime()), `${label}: no flight in the future`);
  yes(flights.some((f) => f.voided_at), `${label}: one voided entry to show`);
  yes(flights.some((f) => f.defects), `${label}: some defects to show`);
  for (const f of flights.filter((x) => x.captain_id && !x.voided_at)) {
    yes(db.bookings.some((b) => b.member_id === f.captain_id && Date.parse(b.starts_at) <= Date.parse(f.brakes_off) && Date.parse(b.ends_at) >= Date.parse(f.brakes_on)), `${label}: flight ${f.id} lies inside a booking of its captain`);
  }

  // The aircraft's numbers add up the way the real database keeps them.
  const group = db.groups[0];
  const flown = Math.round(live.length ? flights.filter((f) => !f.voided_at).reduce((s, f) => s + f.flight_deci, 0) * 10 : 0) / 10;
  eq(group.airframe_total_hours, Math.round((group.airframe_hours_baseline + flown) * 10) / 10, `${label}: total = baseline + flights`);
  eq(group.hours_to_next_check, Math.round((group.next_check_at_hours - group.airframe_total_hours) * 10) / 10, `${label}: hours to check = limit - total`);
  yes(group.hours_to_next_check > 0 && group.hours_to_next_check <= 10, `${label}: the check is "due soon" (shows the warning)`);
  yes(flights.every((f) => f.check_limit_hours === group.next_check_at_hours), `${label}: flights remember the limit`);
}

// ----------------------------------------------------------- reading data
{
  const { engine } = engineAt();
  const read = async (q) => (await q).data;

  const g = await engine.from("groups").select("id, name, slug").eq("slug", "demo").maybeSingle();
  eq(g.data, { id: "demo-group", name: "Demo Flying Group", slug: "demo" }, "select + eq + maybeSingle");
  eq((await engine.from("groups").select("id").eq("slug", "nope").maybeSingle()).data, null, "maybeSingle with no match is null");
  eq((await engine.from("groups").select("id").eq("slug", "nope").single()).error.code, "PGRST116", "single with no match is an error");
  eq((await engine.from("group_members").select("id").maybeSingle()).error.code, "PGRST116", "maybeSingle with several rows is an error");

  const members = await read(engine.from("group_members").select("user_id, display_name, role").eq("group_id", "demo-group").is("removed_at", null).order("created_at"));
  eq(members.map((m) => m.display_name), ["Alex", "Sam", "Jordan", "Taylor"], "ordered members");
  eq(members[0], { user_id: "demo-alex", display_name: "Alex", role: "admin" }, "only the asked-for columns come back");

  const next = await read(engine.from("bookings").select("id, starts_at").eq("status", "confirmed").gte("ends_at", NOW.toISOString()).order("starts_at").limit(1).returns());
  eq(next.length, 1, "limit 1");
  yes(Date.parse(next[0].starts_at) > NOW.getTime(), "the next booking is in the future");

  const desc = await read(engine.from("bookings").select("starts_at").eq("status", "confirmed").order("starts_at", { ascending: false }).limit(2));
  yes(desc[0].starts_at > desc[1].starts_at, "descending order");

  const page1 = await read(engine.from("bookings").select("id").order("starts_at").order("id").range(0, 9));
  const page2 = await read(engine.from("bookings").select("id").order("starts_at").order("id").range(10, 19));
  eq([page1.length, page2.length], [10, 10], "range pages");
  yes(page1.every((r) => !page2.some((s) => s.id === r.id)), "pages do not repeat rows");

  const year = await read(engine.from("flight_entries").select("id").gte("flight_date", "2026-10-01").lt("flight_date", "2026-11-01"));
  yes(year.length > 0, "date filters on flight_date");
  eq((await read(engine.from("flight_entries").select("id").lt("flight_date", "2000-01-01"))).length, 0, "lt matches nothing");
  const viaThen = await engine.from("squawks").select("id").eq("group_id", "demo-group");
  yes(Array.isArray(viaThen.data) && viaThen.data.length >= 5, "awaiting the query itself works");

  const embedded = await read(engine.from("group_members").select("groups(slug)").eq("user_id", "demo-alex").limit(1));
  eq(embedded, [{ groups: { slug: "demo" } }], "the membership's group can be embedded");

  eq((await engine.from("bookings").select("nonsense").limit(1)).error.code, "42703", "unknown selected column is an error");
  eq((await engine.from("bookings").select("id").eq("nonsense", 1)).error.code, "42703", "unknown filter column is an error");
  eq((await engine.from("nothing").select("id")).error.code, "42P01", "unknown table is an error");
  eq((await engine.from("groups").select("id, other(x)")).error.code, "PGRST200", "unsupported embed is an error");

  eq((await engine.auth.getUser()).data.user.id, "demo-alex", "the visitor is Alex");
}

// -------------------------------------------------------- visitor changes
{
  const { engine, state } = engineAt();

  // Bookings: find a free slot, take it, clash with it, cancel it.
  const free = new Date("2026-11-20T08:00:00Z").toISOString();
  const freeEnd = new Date("2026-11-20T12:00:00Z").toISOString();
  eq((await engine.from("bookings").insert({ group_id: "demo-group", member_id: "demo-alex", starts_at: free, ends_at: freeEnd, note: "mine" })).error, null, "booking accepted");
  eq(state.saved, 1, "the change was handed to the cookie");
  const mine = (await engine.from("bookings").select("id, note, member_id, status").eq("note", "mine")).data;
  eq(mine.map((b) => [b.note, b.member_id, b.status]), [["mine", "demo-alex", "confirmed"]], "it shows up in reads straight away");
  eq((await engine.from("bookings").insert({ group_id: "demo-group", member_id: "demo-alex", starts_at: new Date("2026-11-20T10:00:00Z").toISOString(), ends_at: new Date("2026-11-20T14:00:00Z").toISOString() })).error.code, "23P01", "an overlapping booking is refused (exclusion violation)");
  eq((await engine.from("bookings").insert({ group_id: "demo-group", member_id: "demo-alex", starts_at: freeEnd, ends_at: free })).error.code, "23514", "end before start is refused (check violation)");
  eq((await engine.from("bookings").insert({ group_id: "demo-group", member_id: "demo-alex", starts_at: freeEnd, ends_at: new Date("2026-11-20T15:00:00Z").toISOString() })).error, null, "a booking that starts exactly when another ends is fine");
  const touching = (await engine.from("bookings").select("id").eq("note", "mine")).data[0].id;
  await engine.from("bookings").update({ status: "cancelled", cancelled_at: NOW.toISOString(), cancelled_by: "demo-alex" }).eq("id", touching);
  eq((await engine.from("bookings").select("status").eq("id", touching).maybeSingle()).data.status, "cancelled", "cancelling works");
  // a fixture booking can be cancelled too
  const fixtureId = (await engine.from("bookings").select("id").eq("status", "confirmed").gte("ends_at", NOW.toISOString()).order("starts_at").limit(1)).data[0].id;
  await engine.from("bookings").update({ status: "cancelled" }).eq("id", fixtureId);
  eq((await engine.from("bookings").select("status").eq("id", fixtureId).maybeSingle()).data.status, "cancelled", "a demo booking can be cancelled");

  // Chat.
  eq((await engine.from("squawks").insert({ group_id: "demo-group", author_id: "demo-alex", message: "  hello demo  " })).error, null, "message accepted");
  eq((await engine.from("squawks").select("message, author_id").eq("message", "hello demo")).data, [{ message: "hello demo", author_id: "demo-alex" }], "message trimmed, authored by the visitor");
  eq((await engine.from("squawks").insert({ group_id: "demo-group", author_id: "demo-alex", message: "   " })).error.code, "23514", "an empty message is refused");

  // Things the demo does not save.
  eq((await engine.from("groups").update({ name: "x" }).eq("id", "demo-group")).error.code, "demo", "group edits are not saved");
  eq((await engine.from("invites").insert({ group_id: "demo-group" })).error.code, "demo", "invites are not saved");
  eq((await engine.from("bookings").delete().eq("id", "x")).error.code, "demo", "deletes are not supported");
  eq((await (engine.rpc("set_member_role", {}))).data, { result: "demo" }, "other rpc calls answer 'demo'");

  // Flights follow the same rules as add_flight_entry in the database.
  const args = (o = {}) => ({ p_group_id: "demo-group", p_from: "eglm", p_to: "egtk", p_category: "PV", p_captain_id: "demo-sam", p_captain_name: null, p_fuel_left: 22, p_fuel_right: 21.5, p_oil: 7.5, p_brakes_off: "2026-10-07T07:00:00Z", p_airborne: "2026-10-07T07:08:00Z", p_landed: "2026-10-07T08:20:00Z", p_brakes_on: "2026-10-07T08:30:00Z", p_defects: null, ...o });
  const call = async (a) => (await engine.rpc("add_flight_entry", a)).data.result;
  const totalBefore = (await engine.from("groups").select("airframe_total_hours, hours_to_next_check").eq("id", "demo-group").maybeSingle()).data;

  eq(await call(args({ p_from: " " })), "place_required", "place required");
  eq(await call(args({ p_to: "x".repeat(41) })), "place_too_long", "place too long");
  eq(await call(args({ p_category: "XX" })), "category_invalid", "category");
  eq(await call(args({ p_captain_id: "someone" })), "captain_invalid", "captain must be a member");
  eq(await call(args({ p_captain_id: null, p_captain_name: " " })), "captain_required", "guest needs a name");
  eq(await call(args({ p_fuel_left: -1 })), "fuel_invalid", "fuel range");
  eq(await call(args({ p_fuel_right: null })), "fuel_invalid", "fuel required");
  eq(await call(args({ p_oil: 21 })), "oil_invalid", "oil range");
  eq(await call(args({ p_airborne: "2026-10-07T06:59:00Z" })), "times_order", "airborne before brakes off");
  eq(await call(args({ p_landed: "2026-10-07T07:05:00Z" })), "times_order", "landed before airborne");
  eq(await call(args({ p_brakes_on: null })), "times_order", "missing time");
  eq(await call(args({ p_brakes_off: "2026-10-06T10:00:00Z", p_airborne: "2026-10-06T10:05:00Z", p_landed: "2026-10-07T03:00:00Z", p_brakes_on: "2026-10-07T03:10:00Z" })), "too_long", "over 16 hours");
  eq(await call(args({ p_brakes_off: "2026-10-07T13:00:00Z", p_airborne: "2026-10-07T13:05:00Z", p_landed: "2026-10-07T13:50:00Z", p_brakes_on: "2026-10-07T13:55:00Z" })), "in_future", "more than 2 hours ahead");
  eq(state.overlay.f.length, 0, "nothing saved by refused entries");

  eq(await call(args()), "ok", "a valid flight is accepted");
  eq(await call(args()), "overlap", "the same flight again overlaps");
  const after = (await engine.from("groups").select("airframe_total_hours, hours_to_next_check").eq("id", "demo-group").maybeSingle()).data;
  eq(Math.round((after.airframe_total_hours - totalBefore.airframe_total_hours) * 10) / 10, 1.2, "airframe total rises by the flight time (72 min = 1.2 h)");
  eq(Math.round((totalBefore.hours_to_next_check - after.hours_to_next_check) * 10) / 10, 1.2, "hours to check falls by the same");
  const row = (await engine.from("flight_entries").select("from_place, captain_name, block_minutes, flight_minutes, block_deci, flight_deci, created_by").eq("from_place", "EGLM").order("brakes_off", { ascending: false }).limit(1)).data[0];
  eq(row, { from_place: "EGLM", captain_name: "Sam", block_minutes: 90, flight_minutes: 72, block_deci: 1.5, flight_deci: 1.2, created_by: "demo-alex" }, "calculated columns match the database's");
  const id = (await engine.from("flight_entries").select("id").eq("brakes_off", "2026-10-07T07:00:00.000Z")).data[0].id;

  eq((await engine.rpc("void_flight_entry", { p_entry_id: id, p_reason: "x" })).data.result, "reason_required", "void needs a reason");
  eq((await engine.rpc("void_flight_entry", { p_entry_id: "nope", p_reason: "typo" })).data.result, "not_found", "void unknown entry");
  eq((await engine.rpc("void_flight_entry", { p_entry_id: id, p_reason: "entered twice" })).data.result, "ok", "void works");
  eq((await engine.rpc("void_flight_entry", { p_entry_id: id, p_reason: "again please" })).data.result, "already_voided", "void twice");
  const back = (await engine.from("groups").select("airframe_total_hours").eq("id", "demo-group").maybeSingle()).data;
  eq(back.airframe_total_hours, totalBefore.airframe_total_hours, "a voided flight leaves the total");
  eq(await call(args()), "ok", "a voided slot can be used again");

  // Guest captain.
  eq(await call(args({ p_captain_id: null, p_captain_name: "  Pat Guest ", p_brakes_off: "2026-10-07T05:00:00Z", p_airborne: "2026-10-07T05:05:00Z", p_landed: "2026-10-07T05:40:00Z", p_brakes_on: "2026-10-07T05:45:00Z" })), "ok", "guest captain");
  eq((await engine.from("flight_entries").select("captain_id, captain_name").eq("captain_name", "Pat Guest")).data, [{ captain_id: null, captain_name: "Pat Guest" }], "guest has a name and no member id");
}

// ------------------------------------------------------------ the demo's costs
{
  const { engine } = engineAt();
  const stmt = async (month) => (await engine.rpc("cost_statement", { p_group_id: "demo-group", p_month: month })).data;
  const identity = (s) => s.members.every((m) => m.total_pence === m.fixed_pence + m.hourly_pence - m.credit_pence) && s.members.reduce((t, m) => t + m.credit_pence, 0) === s.credits_pence;

  const oct = await stmt("2026-10-01");
  eq([oct.result, oct.is_admin, oct.members.map((m) => m.name)], ["ok", true, ["Alex", "Jordan", "Sam", "Taylor"]], "the demo statement covers the four members, shown to the admin");
  eq([oct.rates.fee_pence, oct.rates.hourly_pence, oct.rates.missing], [12000, 6500, false], "October uses the later demo rates");
  yes(identity(oct), "every total is fixed share + flying - expenses paid");
  const taylor = oct.members.find((m) => m.name === "Taylor");
  eq([taylor.custom_rates, taylor.fixed_pence, taylor.hourly_rate_pence], [true, 0, 9000], "Taylor has rates of their own: no fixed share, a higher hourly rate");
  eq(oct.members.find((m) => m.name === "Sam").fixed_pence, 12000, "everyone else pays the group's fixed share");
  eq((await stmt("2026-02-01")).members.find((m) => m.name === "Taylor").custom_rates, false, "before Taylor's own rates start they follow the group's");
  eq(oct.members.reduce((t, m) => t + m.hours_tenths, 0), oct.hours_tenths, "member hours add up to the month's hours");
  eq((await stmt("2026-02-01")).rates.hourly_pence, 6000, "an earlier month uses the earlier rates");
  eq((await stmt("2024-01-01")).rates.missing, true, "before the first rates: flagged as missing");
  eq((await stmt("nonsense")).result, "month_invalid", "a bad month is refused");
  eq((await stmt("1990-01-01")).result, "month_invalid", "a silly year is refused");
  const sep = await stmt("2026-09-01");
  yes(sep.hours_tenths > 0 && identity(sep), "a full month has hours and adds up");
  yes((await Promise.all(["2026-10-01", "2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01"].map(stmt))).some((x) => x.credits_pence > 0), "some recent month shows an expense credited to a member");

  // closing: older months are shown as closed, last month can be closed, this month cannot
  yes(oct.closed === null && oct.can_close === false, "the current month is open and cannot be closed yet");
  const aug = await stmt("2026-08-01");
  yes(aug.closed !== null && aug.closed.closed_by_name === "Alex" && aug.can_close === false && aug.drift.length === 0, "an older month shows as closed by Alex");
  const lastM = await stmt("2026-09-01");
  yes(lastM.closed === null && lastM.can_close === true, "last month is finished but open, so the visitor sees the Close button");
  yes((await stmt("2024-01-01")).closed === null && (await stmt("2024-01-01")).can_close === false, "a month without rates is never closable");

  // a flight the visitor logs changes their statement
  const before = (await stmt("2026-10-01")).members.find((m) => m.name === "Alex").hours_tenths;
  const logged = (await engine.rpc("add_flight_entry", { p_group_id: "demo-group", p_from: "egxx", p_to: "egxx", p_category: "PV", p_captain_id: "demo-alex", p_captain_name: null, p_fuel_left: 20, p_fuel_right: 20, p_oil: 7, p_brakes_off: "2026-10-07T05:00:00Z", p_airborne: "2026-10-07T05:10:00Z", p_landed: "2026-10-07T06:26:00Z", p_brakes_on: "2026-10-07T06:36:00Z", p_defects: null })).data.result;
  eq(logged, "ok", "the visitor logs a 96-minute block flight");
  const after = await stmt("2026-10-01");
  eq(after.members.find((m) => m.name === "Alex").hours_tenths - before, 16, "...and their statement gains 1.6 block hours");
  yes(identity(after), "...and the totals still add up");

  // the new tables follow the same rules as the others
  eq((await engine.from("cost_rates").select("id").eq("group_id", "demo-group")).data.length, 3, "three demo rate rows (two for the group, one for Taylor)");
  yes((await engine.from("cost_expenses").select("id").eq("group_id", "demo-group")).data.length >= 3, "demo expenses exist");
  eq((await engine.from("cost_expenses").insert({ group_id: "demo-group" })).error.code, "demo", "costs cannot be added in the demo");
}

// ------------------------------------------------- the cookie and its limits
{
  const o = emptyOverlay();
  eq(decodeOverlay(encodeOverlay(o)), o, "empty overlay round-trips");
  const full = { ...o, b: [{ i: "b1", s: 1, e: 2, m: "demo-alex", n: "x" }], c: { b1: 5 }, g: [{ i: "g1", u: "demo-alex", t: "hi", a: 7 }], f: [{ i: "f1", fr: "A", to: "B", ca: "PV", ci: null, cn: "G", fl: 1, fh: 2, o: 3, t: [1, 2, 3, 4], d: "" }], v: { f1: { a: 9, r: "why" } } };
  eq(decodeOverlay(encodeOverlay(full)), full, "a full overlay round-trips");

  for (const bad of [undefined, null, "", "not base64 !!", "e30", Buffer.from("[]").toString("base64url"), Buffer.from("null").toString("base64url"), Buffer.from("{\"b\":\"x\",\"f\":5}").toString("base64url"), "x".repeat(5000)]) {
    eq(decodeOverlay(bad), emptyOverlay(), `a doctored cookie (${String(bad).slice(0, 20)}) becomes empty`);
  }
  const mixed = decodeOverlay(Buffer.from(JSON.stringify({ b: [{ i: "ok", s: 1, e: 2, m: "m", n: "n" }, { i: 5 }, "junk"], c: { a: 1, b: "no" }, g: [], f: [{ i: "f" }], v: { x: { a: 1, r: "r" }, y: 3 } })).toString("base64url"));
  eq([mixed.b.length, Object.keys(mixed.c), mixed.f.length, Object.keys(mixed.v)], [1, ["a"], 0, ["x"]], "bad items are dropped, good ones kept");

  // The limit: keep adding messages until the cookie would be too big.
  const { engine, state } = engineAt();
  let accepted = 0;
  let refused = null;
  for (let i = 0; i < 200 && !refused; i++) {
    const r = await engine.from("squawks").insert({ group_id: "demo-group", author_id: "demo-alex", message: `message number ${i} with some text to use space up`.padEnd(120, "x") });
    if (r.error) refused = r.error; else accepted++;
  }
  yes(accepted >= 8, `at least eight changes fit before the limit (${accepted})`);
  eq(refused.code, "demo_limit", "past the limit the visitor is told to reset");
  yes(overlayFits(state.overlay), "what was saved still fits in a cookie");
}

console.log(`${count} demo checks passed`);
