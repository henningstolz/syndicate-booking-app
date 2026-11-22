// Aircraft downtime (migration 0032): a group admin marks the aircraft unavailable for a period. Checks who may
// add or remove a period, that adding one first only REPORTS the bookings it would cancel and changes nothing,
// that the confirming call must name the same bookings, that exactly the overlapping confirmed bookings are
// cancelled (and nothing else, in this or another group), that each affected member gets one email that their own
// email choices cannot switch off while the group is not emailed per booking, that no booking can be made inside a
// period (and the other rules of booking are unchanged), that removing a period frees the aircraft again, and what
// the calendar feeds show. Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111"; // alice admin; bob, cara members; dan left
const G2 = "22222222-2222-2222-2222-222222222222"; // eve admin
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name,removed_at) values
    ($1,$2,'admin','Alice',null), ($1,$3,'member','Bob',null), ($1,$4,'member','Cara',null), ($1,$5,'member','Dan', now()), ($6,$7,'admin','Eve',null)`,
  [G1, U.alice, U.bob, U.cara, U.dan, G2, U.eve],
);

const t = (day, hour = 0) => new Date(Date.UTC(2030, 5, day, hour)).toISOString(); // June 2030, far in the future
const book = async (group, who, from, to, o = {}) => {
  await db.exec("reset role");
  return (await db.query("insert into public.bookings (group_id, member_id, starts_at, ends_at, note, status) values ($1,$2,$3,$4,$5,$6) returning id",
    [group, U[who], from, to, o.note ?? null, o.status ?? "confirmed"])).rows[0].id;
};
// Period under test: 10 June 00:00 to 13 June 00:00 (10th, 11th and 12th).
const FROM = t(10);
const TO = t(13);
const create = (user, o = {}) =>
  rpc(user, "create_aircraft_downtime", o.group ?? G1, o.from ?? FROM, o.to ?? TO, o.reason ?? "annual", o.note === undefined ? "Annual inspection" : o.note, o.confirm ?? false, o.ids ?? null);

const bBob1 = await book(G1, "bob", t(9, 9), t(9, 11), { note: "before" }); // ends before: untouched
const bBob2 = await book(G1, "bob", t(10, 9), t(10, 11), { note: "inside 1" });
const bBob3 = await book(G1, "bob", t(12, 9), t(12, 12)); // inside
const bCara = await book(G1, "cara", t(12, 22), t(13, 3), { note: "partly inside" }); // starts inside, ends after
const bAlice = await book(G1, "alice", t(11, 8), t(11, 10)); // the admin's own
const bCancelled = await book(G1, "bob", t(11, 13), t(11, 14), { status: "cancelled" }); // already cancelled: ignored
const bAfter = await book(G1, "cara", t(13, 3), t(13, 6)); // starts after the period ends: untouched
const bOther = await book(G2, "eve", t(10, 9), t(10, 11)); // another group: untouched
const IDS = [bBob2, bBob3, bCara, bAlice];
const sorted = (ids) => [...ids].sort();

const status = async (id) => { await db.exec("reset role"); return (await db.query("select status from public.bookings where id = $1", [id])).rows[0].status; };
const emails = async (event = "booking_unavailable") => { await db.exec("reset role"); return (await db.query("select u.email, o.payload, o.event from public.notification_outbox o join auth.users u on u.id = o.recipient_user_id where o.event = $1 order by u.email", [event])).rows; };
const periods = async () => { await db.exec("reset role"); return (await db.query("select id, reason, note, removed_at is not null as removed from public.aircraft_downtime where group_id = $1 order by created_at", [G1])).rows; };

// -------------------------------------------------------------------------------- who may add one
check("a member cannot", result(await create("bob")), "not_allowed");
check("an admin of another group cannot", result(await create("eve")), "not_allowed");
check("anonymous cannot", (await rpc(null, "create_aircraft_downtime", G1, FROM, TO, "annual", null, false, null)).thrown?.includes("permission denied") ?? false, true);
check("a removed member cannot", result(await create("dan")), "not_allowed");
check("an unknown or missing reason is refused", [result(await create("alice", { reason: "holiday" })), result(await rpc("alice", "create_aircraft_downtime", G1, FROM, TO, null, null, false, null))], ["reason_invalid", "reason_invalid"]);
check("a note over 200 characters is refused", result(await create("alice", { note: "x".repeat(201) })), "note_too_long");
check("an end before the start is refused", result(await create("alice", { from: TO, to: FROM })), "period_invalid");
check("a period that is empty or silly is refused", [result(await create("alice", { to: FROM })), result(await create("alice", { from: "1990-01-01T00:00:00Z" })), result(await create("alice", { to: "2200-01-01T00:00:00Z" })), result(await rpc("alice", "create_aircraft_downtime", G1, null, TO, "annual", null, false, null))], ["period_invalid", "period_invalid", "period_invalid", "period_invalid"]);
check("a period that is already over is refused", result(await create("alice", { from: "2020-01-01T00:00:00Z", to: "2020-01-05T00:00:00Z" })), "period_past");
check("nothing was saved by the refused calls", (await periods()).length, 0);

// ------------------------------------------------------------------- the first call only reports
let r = await create("alice");
check("without confirmation it only reports what would be cancelled", [r.result, sorted(r.bookings.map((b) => b.id))], ["needs_confirmation", sorted(IDS)]);
check("...with who and when, and the already cancelled or non-overlapping ones are not in the list", [r.bookings.find((b) => b.id === bCara).who, r.bookings.some((b) => [bBob1, bCancelled, bAfter, bOther].includes(b.id))], ["Cara", false]);
check("...and nothing changed: no period, every booking still confirmed, no email", [(await periods()).length, (await Promise.all(IDS.map(status))).every((s) => s === "confirmed"), (await emails()).length], [0, true, 0]);

// --------------------------------------------------------------- the confirming call must match
r = await create("alice", { confirm: true });
check("confirming without naming the bookings shows the list again instead", [r.result, r.bookings.length], ["bookings_changed", 4]);
r = await create("alice", { confirm: true, ids: [bBob2, bBob3, bCara] }); // missed Alice's own
check("confirming a different list (a booking was made in between) shows the new list instead", [r.result, sorted(r.bookings.map((b) => b.id))], ["bookings_changed", sorted(IDS)]);
r = await create("alice", { confirm: true, ids: [...IDS, bBob1] }); // one too many
check("...also when the list names one that no longer overlaps", r.result, "bookings_changed");
check("still nothing changed", [(await periods()).length, (await Promise.all(IDS.map(status))).every((s) => s === "confirmed")], [0, true]);

// ------------------------------------------------------------- notification choices do not matter
await db.exec("reset role");
await db.query("insert into public.notification_preferences (group_id, user_id, event, enabled) values ($1,$2,'booking_cancelled',false), ($1,$2,'booking_created',false)", [G1, U.bob]);
await db.exec("update auth.users set email = null where id = '" + U.cara + "'"); // Cara has no address: cancelled, but cannot be emailed

// ------------------------------------------------------------------------------------ confirming
r = await create("alice", { confirm: true, ids: IDS });
check("confirming with the right list works", [r.result, r.cancelled, r.emailed], ["ok", 4, 2]);
check("the period is saved with its reason and note", (await periods()).map((p) => [p.reason, p.note, p.removed]), [["annual", "Annual inspection", false]]);
check("exactly the overlapping confirmed bookings were cancelled", [(await Promise.all(IDS.map(status))), await status(bBob1), await status(bAfter), await status(bOther), await status(bCancelled)], [["cancelled", "cancelled", "cancelled", "cancelled"], "confirmed", "confirmed", "confirmed", "cancelled"]);
await db.exec("reset role");
const cancelledRows = (await db.query("select cancelled_by, cancelled_at is not null as at from public.bookings where id = any($1)", [IDS])).rows;
check("...each marked as cancelled by the admin, with a time", cancelledRows.every((c) => c.cancelled_by === U.alice && c.at), true);

let mail = await emails();
check("each affected member with an address gets ONE email (the admin too: their booking was cancelled)", mail.map((m) => m.email), ["alice@example.test", "bob@example.test"]);
check("...Cara has no address, so no email, but her booking was cancelled", [mail.some((m) => m.email.startsWith("cara")), await status(bCara)], [false, "cancelled"]);
const bobMail = mail.find((m) => m.email.startsWith("bob")).payload;
check("Bob's email lists both his cancelled bookings, the reason, the note, the period and who cancelled", [
  bobMail.bookings.map((b) => b.note), bobMail.reason, bobMail.note, bobMail.cancelled_by, bobMail.period_start === FROM || new Date(bobMail.period_start).toISOString() === FROM, new Date(bobMail.period_end).toISOString() === TO,
], [["inside 1", null], "annual", "Annual inspection", "Alice", true, true]);
check("Bob switched off cancellation emails and still got this one", mail.some((m) => m.email.startsWith("bob")), true);
check("the group was NOT emailed once per cancelled booking", (await emails("booking_cancelled")).length, 0);
check("nobody who is not affected got an email (Dan left; Eve is in another group)", mail.some((m) => m.email.startsWith("dan") || m.email.startsWith("eve")), false);

// ---------------------------------------------------------------- no booking inside a period
const tryBook = async (user, from, to, group = G1) => q(user, "insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,$3,$4) returning id", [group, U[user], from, to]);
let res = await tryBook("bob", t(11, 9), t(11, 11));
check("a booking inside the period is refused, with the reason", [res.thrown?.includes("aircraft_unavailable") ?? false], [true]);
res = await h.q("bob", "select 1"); // reset the connection state after the thrown error
await db.exec("reset role");
const detail = await db.query("insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,$3,$4)", [G1, U.bob, t(11, 9), t(11, 11)]).then(() => null, (e) => e.detail ?? null);
check("...the reason travels with the refusal", detail, "annual");
check("a booking that starts inside and ends after is refused too", (await tryBook("cara", t(12, 22), t(13, 3))).thrown?.includes("aircraft_unavailable") ?? false, true);
check("a booking that surrounds the whole period is refused", (await tryBook("cara", t(9, 12), t(14, 12))).thrown?.includes("aircraft_unavailable") ?? false, true);
check("a booking that ends exactly when the period starts is fine", (await tryBook("bob", t(9, 20), t(10, 0))).length, 1);
check("a booking that starts exactly when the period ends is fine (the cancelled booking left that time free)", (await tryBook("cara", t(13, 0), t(13, 2))).length, 1);
check("another group is not affected", (await tryBook("eve", t(11, 9), t(11, 11), G2)).length, 1);
res = await q("bob", "insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,$3,$4) returning id", [G1, U.bob, t(20, 11), t(20, 9)]);
check("the table's own check still reports an end before the start (not a range error)", String(res.thrown ?? "").includes("check constraint"), true);
res = await q("bob", "insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,$3,$4) returning id", [G1, U.bob, t(25, 9), t(25, 11)]);
check("booking a day far from the period works as ever", res.length, 1);

// -------------------------------------------------------------------------------- a clean period
r = await create("alice", { from: t(20), to: t(21), reason: "maintenance", note: null, confirm: false });
check("a period with no bookings in it is saved straight away", [r.result, r.cancelled, r.emailed], ["ok", 0, 0]);
r = await create("alice", { from: t(10, 12), to: t(11, 12), reason: "defect", note: "Overlaps the first period" });
check("periods may overlap each other (an extension), as long as no booking is in the way", r.result, "ok");

// ------------------------------------------------------------------------------- who can read it
check("a member reads the periods", (await q("bob", "select count(*)::int n from public.aircraft_downtime"))[0].n, 3);
check("someone from another group sees none of them", (await q("eve", "select count(*)::int n from public.aircraft_downtime where group_id = $1", [G1]))[0].n, 0);
check("anonymous sees none", (await q(null, "select * from public.aircraft_downtime")).length ?? 0, 0);
check("nobody writes the table directly", [
  (await q("alice", "insert into public.aircraft_downtime (group_id, starts_at, ends_at, reason, created_by) values ($1,$2,$3,'other',$4)", [G1, t(1), t(2), U.alice])).thrown?.includes("row-level security") ?? false,
  (await q("alice", "update public.aircraft_downtime set reason = 'other' returning id")).length,
  (await q("alice", "delete from public.aircraft_downtime returning id")).length,
], [true, 0, 0]);

// ----------------------------------------------------------------------------- removing a period
const first = (await periods())[0].id;
check("a member cannot remove one", result(await rpc("bob", "remove_aircraft_downtime", G1, first)), "not_allowed");
check("an admin of another group cannot", result(await rpc("eve", "remove_aircraft_downtime", G1, first)), "not_allowed");
check("a wrong group or id says not found", [result(await rpc("eve", "remove_aircraft_downtime", G2, first)), result(await rpc("alice", "remove_aircraft_downtime", G1, "99999999-9999-9999-9999-999999999999"))], ["not_found", "not_found"]);
check("an admin removes the first period", result(await rpc("alice", "remove_aircraft_downtime", G1, first)), "ok");
check("...removing it again says not found", result(await rpc("alice", "remove_aircraft_downtime", G1, first)), "not_found");
check("the removed period is kept in the history", (await periods()).filter((p) => p.removed).length, 1);
await db.exec("reset role");
await db.query("delete from public.aircraft_downtime where id in (select id from public.aircraft_downtime where reason = 'defect')");
check("with the period gone the aircraft can be booked there again", (await tryBook("bob", t(11, 9), t(11, 11))).length, 1);
check("...and the bookings that were cancelled stay cancelled", (await Promise.all(IDS.map(status))), ["cancelled", "cancelled", "cancelled", "cancelled"]);

// ----------------------------------------------------------------------------- the calendar feed
await rpc("bob", "create_calendar_feed", G1, "all");
await rpc("bob", "create_calendar_feed", G1, "mine");
await db.exec("reset role");
const tokens = Object.fromEntries((await db.query("select scope, token from public.calendar_feeds where user_id = $1 and revoked_at is null", [U.bob])).rows.map((x) => [x.scope, x.token]));
const feedAll = await rpc(null, "calendar_feed", tokens.all);
const feedMine = await rpc(null, "calendar_feed", tokens.mine);
check("the whole-group feed lists the unavailable periods that are not removed", feedAll.downtime.map((d) => [d.reason, d.note]), [["maintenance", null]]);
check("...with times", [typeof feedAll.downtime[0].starts_at, typeof feedAll.downtime[0].ends_at], ["string", "string"]);
check("the own-bookings feed lists none", feedMine.downtime, []);
check("the feeds still list bookings as before", [feedAll.bookings.length > 0, feedMine.bookings.every((b) => b.mine)], [true, true]);

// ----------------------------------------------------------------------------------- deleting a group
await db.exec("reset role");
await db.exec(`delete from public.groups where id = '${G1}'`);
check("deleting a group takes its unavailable periods with it", (await db.query("select count(*)::int n from public.aircraft_downtime where group_id = $1", [G1])).rows[0].n, 0);

h.finish();
