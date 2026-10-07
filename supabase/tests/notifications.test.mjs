// Email notification database test: who gets queued for what (and who never
// does), preferences, the per-hour cap, removing a member without a flood of
// emails, the sender's secret, and that a notification problem can never block
// a booking, a post or a flight. Run with: npm run test:db
import { createHarness } from "./harness.mjs";
import { NOTIFICATION_EVENTS } from "../../src/lib/notifications.ts";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve");
console.log("all migrations applied");

// Group 1: alice admin, bob and cara members, dan removed. Group 2: eve admin.
const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name,removed_at) values
    ($1,$2,'admin','Alice',null), ($1,$3,'member','Bob',null), ($1,$4,'member','Cara',null),
    ($1,$5,'member','Dan', now()), ($6,$7,'admin','Eve',null)`,
  [G1, U.alice, U.bob, U.cara, U.dan, G2, U.eve],
);

const clear = async () => { await db.exec("reset role"); await db.exec("delete from public.notification_outbox"); };
const queued = async (event) => {
  await db.exec("reset role");
  const rows = (await db.query(
    "select u.email, o.payload, o.group_id from public.notification_outbox o join auth.users u on u.id = o.recipient_user_id where o.event = $1 order by u.email",
    [event],
  )).rows;
  return rows;
};
const who = async (event) => (await queued(event)).map((r) => r.email.split("@")[0]);
const count = async () => { await db.exec("reset role"); return (await db.query("select count(*)::int n from public.notification_outbox")).rows[0].n; };

const book = (user, day, o = {}) => q(user, "insert into public.bookings (group_id, member_id, starts_at, ends_at, note) values ($1, $2, $3, $4, $5) returning id",
  [o.group ?? G1, U[user], `2030-03-${day}T08:00:00Z`, `2030-03-${day}T12:00:00Z`, o.note ?? "Test note"]);
const cancel = (actor, id) => q(actor, "update public.bookings set status='cancelled', cancelled_at=now(), cancelled_by=$2 where id=$1 returning id", [id, U[actor]]);
const post = (user, text, group = G1) => q(user, "insert into public.squawks (group_id, author_id, message) values ($1,$2,$3)", [group, U[user], text]);

const t = (hhmm, day = "2026-09-04") => `${day}T${hhmm}:00Z`;
const flight = (user, o = {}) => rpc(user, "add_flight_entry", G1, "eglm", "eglm", "PV", U[user], null, 24, 23.5, 7,
  o.off ?? t("09:00"), o.up ?? t("09:08"), o.down ?? t("10:20"), o.on ?? t("10:30"), o.defects ?? null);

// --- the list of events matches the database ---------------------------------
for (const e of NOTIFICATION_EVENTS) {
  check(`default for ${e.key} is the same in the app and the database`, (await db.query("select public.notification_default($1) d", [e.key])).rows[0].d, e.defaultOn);
}
check("every event in the app's list can be saved", result(await rpc("bob", "set_notification_preferences", G1, Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.key, e.defaultOn])))), "ok");
await db.exec("reset role"); await db.exec("delete from public.notification_preferences");

// --- bookings ---------------------------------------------------------------
await clear();
const first = await book("bob", "10");
check("a booking is accepted", Array.isArray(first), true);
check("a new booking is queued for the others, not the booker, not a removed member, not another group", await who("booking_created"), ["alice", "cara"]);
const row = (await queued("booking_created"))[0];
check("the queued email carries who, when and the note", [row.payload.who, row.payload.note, row.payload.starts_at.slice(0, 16)], ["Bob", "Test note", "2030-03-10T08:00"]);
check("and belongs to the right group", row.group_id, G1);
check("another group's booking does not notify this group", (await book("eve", "11", { group: G2 }), await who("booking_created")), ["alice", "cara"]);
await clear();
const eveRows = await book("eve", "12", { group: G2 });
check("group 2 has nobody else to tell", [await count(), Array.isArray(eveRows)], [0, true]);

// --- preferences ------------------------------------------------------------
check("a member can switch an event off", result(await rpc("cara", "set_notification_preferences", G1, { booking_created: false })), "ok");
await clear();
await book("bob", "13");
check("...and then is not emailed about it", await who("booking_created"), ["alice"]);
check("...but still about the others", (await cancel("bob", (await q("bob", "select id from public.bookings where starts_at='2030-03-13T08:00:00Z'"))[0].id), await who("booking_cancelled")), ["alice", "cara"]);
check("choices are stored per member", (await q("cara", "select event, enabled from public.notification_preferences")), [{ event: "booking_created", enabled: false }]);
check("a member cannot read another's choices", (await q("bob", "select * from public.notification_preferences")).length, 0);
check("a member cannot write choices directly", (await q("bob", "insert into public.notification_preferences (group_id, user_id, event, enabled) values ($1,$2,'chat_message',false)", [G1, U.bob])).thrown?.includes("row-level security") ?? false, true);
check("nor edit them directly", (await q("cara", "update public.notification_preferences set enabled = true returning event")).length, 0);
check("unknown event refused", result(await rpc("bob", "set_notification_preferences", G1, { nonsense: true })), "invalid");
check("a non-boolean value refused", result(await rpc("bob", "set_notification_preferences", G1, { chat_message: "yes" })), "invalid");
check("not an object refused", result(await rpc("bob", "set_notification_preferences", G1, [true])), "invalid");
check("nothing saved by a refused call", (await q("bob", "select * from public.notification_preferences")).length, 0);
check("a member of another group cannot set choices here", result(await rpc("eve", "set_notification_preferences", G1, { chat_message: false })), "not_allowed");
check("a removed member cannot either", result(await rpc("dan", "set_notification_preferences", G1, { chat_message: false })), "not_allowed");
check("anonymous cannot", (await rpc(null, "set_notification_preferences", G1, {})).thrown?.includes("permission denied") ?? false, true);
check("choices can be saved again (updated, not duplicated)", [result(await rpc("cara", "set_notification_preferences", G1, { booking_created: true })), (await q("cara", "select enabled from public.notification_preferences where event='booking_created'"))], ["ok", [{ enabled: true }]]);

// --- cancellations ----------------------------------------------------------
await clear();
const bobsId = (await book("bob", "14"))[0].id;
await clear();
await cancel("alice", bobsId);
check("an admin cancelling bob's booking tells bob (and cara), not alice", await who("booking_cancelled"), ["bob", "cara"]);
const cancelled = (await queued("booking_cancelled"))[0];
check("the email says who cancelled it", [cancelled.payload.who, cancelled.payload.cancelled_by], ["Bob", "Alice"]);
await clear();
const selfId = (await book("cara", "15"))[0].id;
await clear();
await cancel("cara", selfId);
check("cancelling your own booking tells the others, not you", await who("booking_cancelled"), ["alice", "bob"]);
check("...with nobody named as the canceller", (await queued("booking_cancelled"))[0].payload.cancelled_by, null);
await clear();
await cancel("cara", selfId);
check("cancelling twice does not notify twice", await count(), 0);

// --- removing a member or leaving: no flood of emails ---------------------------
await clear();
for (const day of ["16", "17", "18"]) await book("bob", day);
await clear();
// bob has four upcoming bookings by now: the 10th (first test) and the 16th to 18th
check("admin removes bob", await rpc("alice", "remove_member", G1, U.bob), { result: "ok", cancelled_bookings: 4 });
check("his upcoming bookings were cancelled but nobody was emailed about each", await count(), 0);
await db.exec("reset role");
await db.exec(`update public.group_members set removed_at = null where user_id = '${U.bob}'`);
await clear();
for (const day of ["19", "20"]) await book("cara", day);
await clear();
check("cara leaves", await rpc("cara", "leave_group", G1), { result: "ok", cancelled_bookings: 2 });
check("leaving does not email per booking either", await count(), 0);
await db.exec("reset role");
await db.exec(`update public.group_members set removed_at = null where user_id = '${U.cara}'`);
await clear();
const afterId = (await book("cara", "21"))[0].id;
await clear();
await cancel("cara", afterId);
check("an ordinary cancellation still notifies afterwards (the quiet mode ended with the removal)", await who("booking_cancelled"), ["alice", "bob"]);

// --- chat ---------------------------------------------------------------------
await clear();
await post("alice", "Fuel bowser is out of order");
check("a chat message goes to the others, never the author", await who("chat_message"), ["bob", "cara"]);
check("it carries the text and the author", [(await queued("chat_message"))[0].payload.who, (await queued("chat_message"))[0].payload.message], ["Alice", "Fuel bowser is out of order"]);
await clear();
await post("alice", "x".repeat(900));
check("a long message is cut to 500 characters", (await queued("chat_message"))[0].payload.message.length, 500);
await clear();
await rpc("bob", "set_notification_preferences", G1, { chat_message: false });
await post("alice", "quiet please");
check("a member who switched chat off is not emailed", await who("chat_message"), ["cara"]);
await rpc("bob", "set_notification_preferences", G1, { chat_message: true });

// --- flights and defects ---------------------------------------------------------
await clear();
check("a flight is logged", result(await flight("alice")), "ok");
check("by default nobody is emailed about a routine flight", await count(), 0);
await rpc("bob", "set_notification_preferences", G1, { flight_logged: true });
await rpc("cara", "set_notification_preferences", G1, { flight_logged: true, defect_reported: false });
await clear();
await flight("alice", { off: t("11:00"), up: t("11:08"), down: t("12:20"), on: t("12:30") });
check("a routine flight goes to those who asked for flights", await who("flight_logged"), ["bob", "cara"]);
check("...with route, captain and flight time", (({ from, to, captain, flight_deci }) => [from, to, captain, Number(flight_deci)])((await queued("flight_logged"))[0].payload), ["EGLM", "EGLM", "Alice", 1.2]);
await clear();
await flight("alice", { off: t("13:00"), up: t("13:08"), down: t("14:20"), on: t("14:30"), defects: "Transponder intermittent" });
check("a defect goes to those who want defects (bob, who also wants flights, gets only this one)", await who("defect_reported"), ["bob"]);
check("cara wants flights but not defects, so she gets the routine email", await who("flight_logged"), ["cara"]);
check("nobody gets both emails for one flight", (await who("defect_reported")).filter((n) => ["cara"].includes(n)).length + (await who("flight_logged")).filter((n) => n === "bob").length, 0);
check("the defect email carries the defect text", (await queued("defect_reported"))[0].payload.defects, "Transponder intermittent");
await clear();
await flight("bob", { off: t("15:00"), up: t("15:08"), down: t("16:20"), on: t("16:30"), defects: "Left brake spongy" });
check("the person logging is never emailed (bob logs: alice and cara hear, defect default on for alice)", [await who("defect_reported"), await who("flight_logged")], [["alice"], ["cara"]]);
await clear();
await rpc("alice", "void_flight_entry", (await q("alice", "select id from public.flight_entries order by brakes_off limit 1"))[0].id, "wrong day");
check("voiding a flight sends nothing", await count(), 0);

// --- the hourly cap -------------------------------------------------------------
await clear();
for (let i = 0; i < 25; i++) await post("alice", `message ${i}`);
await db.exec("reset role");
const perPerson = (await db.query("select u.email, count(*)::int n from public.notification_outbox o join auth.users u on u.id = o.recipient_user_id group by 1 order by 1")).rows;
check("no one is queued more than 20 emails an hour", perPerson, [{ email: "bob@example.test", n: 20 }, { email: "cara@example.test", n: 20 }]);

// --- a member without an email address, and a failing queue ---------------------
await clear();
await db.exec("reset role");
await db.exec(`update auth.users set email = null where id = '${U.bob}'`);
await post("alice", "no address for bob");
check("a member with no email address is simply skipped", await who("chat_message"), ["cara"]);
await db.exec("reset role");
await db.exec(`update auth.users set email = 'bob@example.test' where id = '${U.bob}'`);

await clear();
await db.exec("reset role");
await db.exec("alter table public.notification_outbox add constraint boom check (false) not valid");
const survived = await post("alice", "this must still be saved");
await db.exec("reset role");
check("a broken queue does not stop the chat message being saved", [survived.thrown, (await db.query("select count(*)::int n from public.squawks where message = 'this must still be saved'")).rows[0].n], [undefined, 1]);
const bookingSurvived = await book("alice", "22");
check("...or a booking", Array.isArray(bookingSurvived), true);
await db.exec("reset role");
await db.exec("alter table public.notification_outbox drop constraint boom");
check("...and nothing was queued while it was broken", await count(), 0);

// --- the sender's secret ------------------------------------------------------
await clear();
await post("alice", "to be claimed");
const TOKEN = "k".repeat(48);
await db.exec("reset role");
await db.query("insert into public.notification_worker (token_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))", [TOKEN]);
const claim = (token, limit = 20) => q(null, "select * from public.claim_notifications($1, $2)", [token, limit]);

check("no secret, no emails", (await claim(null)).length, 0);
check("a wrong secret gets nothing", (await claim("w".repeat(48))).length, 0);
check("a too-short secret gets nothing", (await claim("short")).length, 0);
check("marking with a wrong secret does nothing", (await rpc(null, "mark_notification_sent", "w".repeat(48), "00000000-0000-0000-0000-000000000000")), false);
const got = await claim(TOKEN);
check("the right secret gets the queued emails, with the group's name and address", got.map((r) => [r.recipient_email, r.event, r.group_name, r.group_slug]).sort(), [["bob@example.test", "chat_message", "Group One", "one"], ["cara@example.test", "chat_message", "Group One", "one"]]);
check("the message text is included", got[0].payload.message, "to be claimed");
await db.exec("reset role");
check("each claim counts an attempt", (await db.query("select distinct attempts a from public.notification_outbox")).rows, [{ a: 1 }]);
check("a second claim straight away gets nothing (give the first a chance)", (await claim(TOKEN)).length, 0);

check("report one sent", await rpc(null, "mark_notification_sent", TOKEN, got[0].id), true);
check("...it is not handed out again", [(await q(null, "select 1 where false")).length, (await (async () => { await db.exec("reset role"); await db.exec("update public.notification_outbox set last_attempt_at = now() - interval '3 minutes'"); return claim(TOKEN); })()).map((r) => r.id)], [0, [got[1].id]]);
check("report one failed, with a reason", await rpc(null, "mark_notification_failed", TOKEN, got[1].id, "e".repeat(500)), true);
await db.exec("reset role");
check("the reason is kept, cut to 300 characters", (await db.query("select char_length(last_error)::int n from public.notification_outbox where id = $1", [got[1].id])).rows[0].n, 300);
check("a sent email cannot be re-marked failed", await rpc(null, "mark_notification_failed", TOKEN, got[0].id, "late"), false);

// retries stop after five attempts, and old emails are not sent
await db.exec("reset role");
await db.exec("update public.notification_outbox set last_attempt_at = now() - interval '3 minutes', attempts = 4 where sent_at is null");
check("a fifth attempt is still made", (await claim(TOKEN)).length, 1);
await db.exec("reset role");
await db.exec("update public.notification_outbox set last_attempt_at = now() - interval '3 minutes' where sent_at is null");
check("but not a sixth", (await claim(TOKEN)).length, 0);

await clear();
await post("alice", "an old one");
await db.exec("reset role");
await db.exec("update public.notification_outbox set created_at = now() - interval '25 hours'");
check("an email more than a day old is not sent", (await claim(TOKEN)).length, 0);
await db.exec("reset role");
await db.exec("update public.notification_outbox set created_at = now() - interval '8 days'");
await claim(TOKEN);
check("and a week-old unsent one is cleaned away", await count(), 0);

// --- the queue and the secret are not readable through the API --------------------
await clear();
await post("alice", "private");
check("a member cannot read the queue", (await q("bob", "select * from public.notification_outbox")).length, 0);
check("nor add to it", (await q("bob", "insert into public.notification_outbox (group_id, recipient_user_id, recipient_email, event) values ($1,$2,'x@y.z','chat_message')", [G1, U.bob])).thrown !== undefined, true);
check("nor read the sender's secret", (await q("bob", "select * from public.notification_worker")).length, 0);
check("anonymous visitors cannot read the queue", (await q(null, "select * from public.notification_outbox")).thrown?.includes("permission denied") ?? false, true);
check("the internal queuing function is not callable", (await rpc("bob", "enqueue_notification", G1, "chat_message", U.bob, {})).thrown !== undefined, true);

h.finish();
