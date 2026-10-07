// Reminder emails: the evening-before booking reminder and the aircraft due
// date / hours reminders. Checks UK days (including across the clocks
// changing), that each reminder is sent once, that a renewal restarts the
// countdown, who is and isn't emailed, and that the secret is required.
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve");
console.log("all migrations applied");

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
const TOKEN = "r".repeat(48);
await db.query("insert into public.notification_worker (token_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))", [TOKEN]);

const run = async (now, group = null, token = TOKEN) => (await rpc(null, "queue_reminders", token, group, now));
const wipe = async () => { await db.exec("reset role"); await db.exec("delete from public.notification_outbox"); };
const emails = async (event) => {
  await db.exec("reset role");
  return (await db.query("select u.email, o.payload from public.notification_outbox o join auth.users u on u.id = o.recipient_user_id where o.event = $1 order by u.email", [event])).rows;
};
const who = async (event) => (await emails(event)).map((r) => r.email.split("@")[0]);
const setGroup = async (id, cols) => {
  await db.exec("reset role");
  const sets = Object.keys(cols).map((k, i) => `${k} = $${i + 2}`).join(", ");
  await db.query(`update public.groups set ${sets} where id = $1`, [id, ...Object.values(cols)]);
};
// A booking made long ago, so "made in the last three hours" does not apply.
const book = async (user, starts, ends, o = {}) => {
  await db.exec("reset role");
  return (await db.query(
    "insert into public.bookings (group_id, member_id, starts_at, ends_at, note, created_at) values ($1,$2,$3,$4,$5,$6) returning id",
    [o.group ?? G1, U[user], starts, ends, o.note ?? "Reminder test", o.created ?? "2026-01-01T00:00:00Z"],
  )).rows[0].id;
};

// ---------------------------------------------------------- the secret
check("no secret, no reminders", (await run("2026-10-09T16:00:00Z", null, null)).result, "not_allowed");
check("a wrong secret is refused", (await run("2026-10-09T16:00:00Z", null, "w".repeat(48))).result, "not_allowed");
check("a signed-in member with a wrong secret is refused", (await rpc("bob", "queue_reminders", "w".repeat(48), null, "2026-10-09T16:00:00Z")).result, "not_allowed");

// ----------------------------------------------------- booking reminders
await wipe();
const NOW = "2026-10-09T16:00:00Z"; // Fri 9 Oct, 17:00 UK (BST)
await book("bob", "2026-10-10T07:00:00Z", "2026-10-10T11:00:00Z"); // Sat 8:00-12:00 UK
await book("cara", "2026-10-11T07:00:00Z", "2026-10-11T11:00:00Z"); // the day after tomorrow
await book("cara", "2026-10-09T18:00:00Z", "2026-10-09T20:00:00Z"); // later today
let r = await run(NOW);
check("a reminder is queued for tomorrow's booking only", [r.result, r.booking_reminders], ["ok", 1]);
check("...to the person who booked it, not the others", await who("booking_reminder"), ["bob"]);
const rem = (await emails("booking_reminder"))[0].payload;
check("...with the times and the note", [rem.starts_at.slice(0, 16), rem.ends_at.slice(0, 16), rem.note], ["2026-10-10T07:00", "2026-10-10T11:00", "Reminder test"]);
await wipe();
r = await run(NOW);
check("running again does not remind twice", [r.booking_reminders, await who("booking_reminder")], [0, []]);

// a booking made less than three hours ago is not reminded
await wipe();
await book("cara", "2026-10-10T13:00:00Z", "2026-10-10T15:00:00Z", { created: "2026-10-09T14:00:00Z" }); // made 2h ago
r = await run(NOW);
check("a booking made two hours ago is not reminded", r.booking_reminders, 0);
r = await run("2026-10-09T17:30:00Z");
check("but is, once it is more than three hours old", [r.booking_reminders, await who("booking_reminder")], [1, ["cara"]]);

// who is not reminded
await wipe();
const cancelledId = await book("bob", "2026-10-17T07:00:00Z", "2026-10-17T11:00:00Z");
await db.exec("reset role");
await db.query("update public.bookings set status = 'cancelled' where id = $1", [cancelledId]);
await book("dan", "2026-10-17T12:00:00Z", "2026-10-17T14:00:00Z"); // dan was removed
r = await run("2026-10-16T16:00:00Z");
check("cancelled bookings and removed members are not reminded", [r.booking_reminders, await who("booking_reminder")], [0, []]);
await wipe();
await rpc("cara", "set_notification_preferences", G1, { booking_reminder: false });
await book("cara", "2026-10-24T07:00:00Z", "2026-10-24T11:00:00Z");
r = await run("2026-10-23T16:00:00Z");
check("a member who switched reminders off is not emailed", [r.booking_reminders, await who("booking_reminder")], [0, []]);
await rpc("cara", "set_notification_preferences", G1, { booking_reminder: true });

// a multi-day booking is reminded the evening before it STARTS, not each day
await wipe();
await book("alice", "2026-10-30T07:00:00Z", "2026-11-01T17:00:00Z");
check("evening before the first day: reminded", (await run("2026-10-29T16:00:00Z")).booking_reminders, 1);
check("evening before the second day: not again", (await run("2026-10-30T16:00:00Z")).booking_reminders, 0);

// UK days, not UTC days
await wipe();
// 00:30 BST on Sat 31 Oct... use a clean summer example: Fri 3 Jul 2026 00:30 BST = Thu 2 Jul 23:30Z
await book("bob", "2026-07-02T23:30:00Z", "2026-07-03T03:00:00Z");
r = await run("2026-07-02T16:00:00Z"); // Thu 2 Jul 17:00 BST: the booking is tomorrow (3 Jul UK) although it is still 2 Jul in UTC
check("a booking at 00:30 UK tomorrow counts as tomorrow, even though it is still 'today' in UTC", [r.booking_reminders, await who("booking_reminder")], [1, ["bob"]]);
await wipe();
await book("bob", "2026-12-04T23:30:00Z", "2026-12-05T03:00:00Z"); // winter: 23:30 UTC is 23:30 UK on the 4th
r = await run("2026-12-03T16:00:00Z"); // Thu 3 Dec; the booking is on Fri 4 Dec UK
check("in winter the same hour is a different UK day", [r.booking_reminders, await who("booking_reminder")], [1, ["bob"]]);

// the other group's bookings are scoped
await wipe();
await book("eve", "2026-11-14T07:00:00Z", "2026-11-14T11:00:00Z", { group: G2 });
await run("2026-11-13T16:00:00Z", G1);
check("asking for one group leaves the other's reminders alone", await who("booking_reminder"), []);
await run("2026-11-13T16:00:00Z", G2);
check("...and its own are queued", await who("booking_reminder"), ["eve"]);

// --------------------------------------------------- aircraft: due dates
await wipe();
await db.exec("reset role");
await db.exec("delete from public.reminder_log");
const D = "2027-03-10"; // the 'today' for these tests
const at = (d) => `${d}T16:00:00Z`;
check("nothing due, nothing queued", [(await run(at(D))).aircraft_reminders, await count()], [0, 0]);
async function count() { await db.exec("reset role"); return (await db.query("select count(*)::int n from public.notification_outbox")).rows[0].n; }

await setGroup(G1, { insurance_renewal_due: "2027-04-08" }); // 29 days away
r = await run(at(D));
check("a due date 29 days away sends the 30-day reminder to every current member", [r.aircraft_reminders, await who("aircraft_reminder")], [3, ["alice", "bob", "cara"]]);
let items = (await emails("aircraft_reminder"))[0].payload;
check("it names the item, the date and the days left", [items.registration, items.items.length, items.items[0].item, items.items[0].due, items.items[0].days, items.items[0].stage], ["G-ONE", 1, "Insurance renewal", "2027-04-08", 29, "30"]);
await wipe();
check("the next day it does not send again", [(await run(at("2027-03-11"))).aircraft_reminders, await count()], [0, 0]);
check("at 6 days it sends the 7-day reminder", [(await run(at("2027-04-02"))).aircraft_reminders, await who("aircraft_reminder")], [3, ["alice", "bob", "cara"]]);
await wipe();
check("and not again at 5 days", [(await run(at("2027-04-03"))).aircraft_reminders, await count()], [0, 0]);
check("on the due date: still the 7-day stage, already sent, nothing new", [(await run(at("2027-04-08"))).aircraft_reminders, await count()], [0, 0]);
check("the day after it is overdue: one more email", [(await run(at("2027-04-09"))).aircraft_reminders, (await emails("aircraft_reminder"))[0].payload.items[0].stage], [3, "overdue"]);
await wipe();
check("and no nagging after that", [(await run(at("2027-04-20"))).aircraft_reminders, await count()], [0, 0]);

// a renewal starts the countdown again
await setGroup(G1, { insurance_renewal_due: "2028-04-08" });
check("a renewed date is not due, so nothing", [(await run(at("2027-04-21"))).aircraft_reminders, await count()], [0, 0]);
check("a year later the new date starts its own countdown", [(await run(at("2028-03-15"))).aircraft_reminders, await count()], [3, 3]);
await wipe();

// several items on one day: one email each, listing them all
await setGroup(G1, { insurance_renewal_due: null, annual_renewal_due: "2028-05-20", life_raft_due: "2028-05-25", fire_extinguisher_due: "2028-06-10" });
r = await run(at("2028-05-15")); // annual in 5 days (7-stage), raft in 10 (30), extinguisher in 26 (30)
items = (await emails("aircraft_reminder"))[0].payload.items;
check("three items due the same day make ONE email per member", [r.aircraft_reminders, await count()], [3, 3]);
check("...listing all three", items.map((i) => `${i.item}:${i.stage}`).sort(), ["Annual/permit renewal:7", "Fire extinguisher:30", "Life raft:30"]);
await wipe();

// ---------------------------------------------------- aircraft: hours
await db.exec("reset role");
await db.exec("delete from public.reminder_log");
await setGroup(G1, { annual_renewal_due: null, life_raft_due: null, fire_extinguisher_due: null, hours_to_next_check: 12.5, next_check_at_hours: 5900 });
check("12.5 hours left: nothing yet", [(await run(at("2029-01-10"))).aircraft_reminders, await count()], [0, 0]);
await setGroup(G1, { hours_to_next_check: 9.2 });
r = await run(at("2029-01-11"));
check("9.2 hours left: the 10-hour reminder", [r.aircraft_reminders, (await emails("aircraft_reminder"))[0].payload.items[0].stage, (await emails("aircraft_reminder"))[0].payload.items[0].hours], [3, "10", 9.2]);
await wipe();
check("still 9.2 the next day: not again", [(await run(at("2029-01-12"))).aircraft_reminders, await count()], [0, 0]);
await setGroup(G1, { hours_to_next_check: 4.1 });
check("4.1 hours left: the 5-hour reminder", [(await run(at("2029-01-13"))).aircraft_reminders, (await emails("aircraft_reminder"))[0].payload.items[0].stage], [3, "5"]);
await wipe();
await setGroup(G1, { hours_to_next_check: -0.4 });
check("past the limit: the overdue reminder", [(await run(at("2029-01-14"))).aircraft_reminders, (await emails("aircraft_reminder"))[0].payload.items[0].stage], [3, "overdue"]);
await wipe();
// after the check is done the limit moves: a new countdown
await setGroup(G1, { hours_to_next_check: 98, next_check_at_hours: 6000 });
check("after a check (new limit, plenty of hours) nothing is sent", [(await run(at("2029-02-01"))).aircraft_reminders, await count()], [0, 0]);
await setGroup(G1, { hours_to_next_check: 8 });
check("and the next time it runs low the 10-hour reminder is sent again", [(await run(at("2029-06-01"))).aircraft_reminders, (await emails("aircraft_reminder"))[0].payload.items[0].stage], [3, "10"]);
await wipe();

// ---------------------------------------------------- who gets aircraft emails
await db.exec("reset role");
await db.exec("delete from public.reminder_log");
await setGroup(G1, { hours_to_next_check: null, next_check_due: "2029-07-05" });
await rpc("bob", "set_notification_preferences", G1, { aircraft_reminder: false });
r = await run(at("2029-07-01"));
check("a member who switched aircraft reminders off is skipped", [r.aircraft_reminders, await who("aircraft_reminder")], [2, ["alice", "cara"]]);
await rpc("bob", "set_notification_preferences", G1, { aircraft_reminder: true });
await wipe();
await db.exec("reset role");
await db.exec(`update auth.users set email = null where id = '${U.alice}'`);
await setGroup(G1, { next_check_due: "2029-08-03" });
r = await run(at("2029-08-01"));
check("a member without an email address is skipped", await who("aircraft_reminder"), ["bob", "cara"]);
await db.exec("reset role");
await db.exec(`update auth.users set email = 'alice@example.test' where id = '${U.alice}'`);
await wipe();
// the memory is kept even if nobody could be emailed
await db.exec("reset role");
await db.exec("delete from public.reminder_log");
await setGroup(G2, { next_check_due: "2029-09-03" });
await rpc("eve", "set_notification_preferences", G2, { aircraft_reminder: false });
r = await run(at("2029-09-01"), G2);
check("a group where nobody wants it: nothing queued", [r.aircraft_reminders, await count()], [0, 0]);
await rpc("eve", "set_notification_preferences", G2, { aircraft_reminder: true });
check("...and it is not sent later either (it was handled once)", [(await run(at("2029-09-02"), G2)).aircraft_reminders, await count()], [0, 0]);

// ---------------------------------------------------- housekeeping
await db.exec("reset role");
await db.exec("delete from public.reminder_log");
await db.query("insert into public.reminder_log (group_id, key, created_at) values ($1, 'booking:old', now() - interval '40 days'), ($1, 'aircraft:next_check:2020-01-01:7', now() - interval '400 days')", [G1]);
await run(at("2030-01-01"));
await db.exec("reset role");
const keys = (await db.query("select key from public.reminder_log")).rows.map((x) => x.key);
check("old booking memories are cleared, aircraft ones are kept", [keys.includes("booking:old"), keys.includes("aircraft:next_check:2020-01-01:7")], [false, true]);

// ---------------------------------------------------- lock-down
check("members cannot read the reminder memory", (await q("bob", "select * from public.reminder_log")).length, 0);
check("nor write to it", (await q("bob", "insert into public.reminder_log (group_id, key) values ($1, 'x')", [G1])).thrown !== undefined, true);
check("the internal queuing function is not callable", (await rpc("bob", "enqueue_notification_for", G1, U.bob, "booking_reminder", {})).thrown !== undefined, true);

h.finish();
