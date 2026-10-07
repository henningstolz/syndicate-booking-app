// End to end, minus the network: real events go through the real database
// triggers into the queue, are claimed with the sender's secret, written by the
// real email writer and handed to a fake "Resend". This catches any mismatch
// between what the database queues and what the email writer expects.
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";
import { flushQueue } from "../../src/lib/notify/send-core.ts";

const h = createHarness();
const { db, U, rpc, q, check } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara");
console.log("all migrations applied");

const G = "11111111-1111-1111-1111-111111111111";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values ('${G}','one','Group One','G-ONE');`);
await db.query("insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Alice'),($1,$3,'member','Bob'),($1,$4,'member','Cara')", [G, U.alice, U.bob, U.cara]);

const TOKEN = "e".repeat(48);
await db.query("insert into public.notification_worker (token_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))", [TOKEN]);
// Only Cara listens, so one event gives one email.
await rpc("alice", "set_notification_preferences", G, { booking_created: false, booking_cancelled: false, chat_message: false, defect_reported: false });
await rpc("bob", "set_notification_preferences", G, { booking_created: false, booking_cancelled: false, chat_message: false, defect_reported: false });
await rpc("cara", "set_notification_preferences", G, { flight_logged: true });

// The sender, wired to the real database functions instead of Resend.
async function runSender() {
  const posted = [];
  const result = await flushQueue({
    claim: async (limit) => (await q(null, "select * from public.claim_notifications($1, $2)", [TOKEN, limit])),
    markSent: async (id) => { await rpc(null, "mark_notification_sent", TOKEN, id); },
    markFailed: async (id, error) => { await rpc(null, "mark_notification_failed", TOKEN, id, error); },
    post: async (email) => { posted.push(email); return { ok: true }; },
    sleep: async () => {},
    siteUrl: "https://blocktime.group",
  }, 10);
  await db.exec("reset role");
  return { result, posted };
}
const wipe = async () => { await db.exec("reset role"); await db.exec("delete from public.notification_outbox"); };
const book = (user, day, h1 = "08", h2 = "12") => q(user, "insert into public.bookings (group_id, member_id, starts_at, ends_at, note) values ($1,$2,$3,$4,'Fly-out lunch') returning id", [G, U[user], `2030-03-${day}T${h1}:00:00Z`, `2030-03-${day}T${h2}:00:00Z`]);

// ------------------------------------------------------------------ chat
await rpc("cara", "set_notification_preferences", G, { chat_message: true });
await q("bob", "insert into public.squawks (group_id, author_id, message) values ($1,$2,$3)", [G, U.bob, "Anyone for <b>Duxford</b> on Saturday?"]);
let run = await runSender();
check("a chat message becomes one sent email", run.result, { sent: 1, failed: 0 });
check("to Cara, with the author and text", [run.posted[0].to, run.posted[0].subject], ["cara@example.test", "Bob posted in Group One"]);
check("the typed HTML is escaped in the email", [run.posted[0].html.includes("<b>Duxford</b>"), run.posted[0].html.includes("&lt;b&gt;Duxford&lt;/b&gt;")], [false, true]);
check("and the queue shows it as sent", (await db.query("select count(*)::int n from public.notification_outbox where sent_at is not null")).rows[0].n, 1);
run = await runSender();
check("nothing is sent twice", run.result, { sent: 0, failed: 0 });
await rpc("cara", "set_notification_preferences", G, { chat_message: false });

// -------------------------------------------------------------- bookings
await wipe();
await rpc("cara", "set_notification_preferences", G, { booking_created: true, booking_cancelled: true });
const bookingId = (await book("bob", "10"))[0].id;
run = await runSender();
check("a booking: subject has the UK date and time (2030-03-10 is GMT, 08:00-12:00 UTC)", run.posted[0].subject, "New booking: Bob, Sun 10 Mar, 08:00–12:00");
check("the note and the calendar link are in the text", [run.posted[0].text.includes("Note: Fly-out lunch"), run.posted[0].text.includes("/one/calendar?view=list&start=2030-03-10")], [true, true]);
await q("alice", "update public.bookings set status='cancelled', cancelled_at=now(), cancelled_by=$2 where id=$1", [bookingId, U.alice]);
run = await runSender();
check("a cancellation by an admin names the admin", [run.posted[0].subject, run.posted[0].text.includes("Bob's booking was cancelled by Alice")], ["Booking cancelled: Bob, Sun 10 Mar, 08:00–12:00", true]);
// summer time
await book("bob", "29", "09", "13"); // 2030-03-29 is still GMT (BST starts 31 March)
await q("bob", "insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,'2030-04-02T08:00:00Z','2030-04-02T12:00:00Z')", [G, U.bob]);
run = await runSender();
check("in summer time the same UTC hours read an hour later", run.posted.map((p) => p.subject).sort(), ["New booking: Bob, Fri 29 Mar, 09:00–13:00", "New booking: Bob, Tue 2 Apr, 09:00–13:00"]);

// ---------------------------------------------------------------- flights
await wipe();
const flight = (o = {}) => rpc("bob", "add_flight_entry", G, "eglm", "egtk", "PV", U.bob, null, 24, 23.5, 7, o.off ?? "2026-09-04T09:00:00Z", o.up ?? "2026-09-04T09:08:00Z", o.down ?? "2026-09-04T10:20:00Z", o.on ?? "2026-09-04T10:30:00Z", o.defects ?? null);
check("a flight is logged", (await flight()).result, "ok");
run = await runSender();
check("flight email: route, captain and flight time as a number", [run.posted[0].subject, run.posted[0].text.includes("1.2 h flight time")], ["Flight logged: EGLM → EGTK, Bob", true]);
await rpc("cara", "set_notification_preferences", G, { defect_reported: true });
check("a flight with a defect is logged", (await flight({ off: "2026-09-05T09:00:00Z", up: "2026-09-05T09:08:00Z", down: "2026-09-05T10:20:00Z", on: "2026-09-05T10:30:00Z", defects: "Left brake <spongy>" })).result, "ok");
run = await runSender();
check("it sends one defect email, not two", [run.posted.length, run.posted[0].subject], [1, "Defect reported: EGLM → EGTK"]);
check("the defect text is quoted and escaped", [run.posted[0].text.includes("Defect: Left brake <spongy>"), run.posted[0].html.includes("Left brake &lt;spongy&gt;")], [true, true]);

// -------------------------------------------------------------- reminders
await wipe();
await rpc("cara", "set_notification_preferences", G, { booking_reminder: true, aircraft_reminder: true });
await rpc("alice", "set_notification_preferences", G, { booking_reminder: false, aircraft_reminder: false });
await rpc("bob", "set_notification_preferences", G, { booking_reminder: false, aircraft_reminder: false });
await db.exec("reset role");
await db.exec("delete from public.reminder_log; delete from public.bookings");
await db.query("insert into public.bookings (group_id, member_id, starts_at, ends_at, note, created_at) values ($1,$2,'2030-05-11T07:00:00Z','2030-05-11T11:00:00Z','Early start','2030-05-01T00:00:00Z')", [G, U.cara]);
await db.query("update public.groups set next_check_due = '2030-05-17', hours_to_next_check = 8.6, next_check_at_hours = 2429.7 where id = $1", [G]);
const queuedReminders = await rpc(null, "queue_reminders", TOKEN, null, "2030-05-10T16:00:00Z");
check("the reminder job queues the booking reminder and one aircraft email", [queuedReminders.booking_reminders, queuedReminders.aircraft_reminders], [1, 1]);
run = await runSender();
const subjects = run.posted.map((m) => m.subject).sort();
check("the real queued data reads correctly in both emails (BST: 07:00 UTC is 08:00 UK)", subjects, ["Aircraft reminder: 2 items need attention", "Reminder: you're booked tomorrow, Sat 11 May, 08:00–12:00"]);
const aircraftMail = run.posted.find((m) => m.subject.startsWith("Aircraft"));
check("the aircraft email lists the date and the hours, with numbers intact", [aircraftMail.text.includes("Next check: due in 7 days (Fri 17 May 2030)"), aircraftMail.text.includes("Hours to next check: 8.6 hours left (check at 2429.7 h)"), aircraftMail.to], [true, true, "cara@example.test"]);
run = await runSender();
check("and nothing more is sent on a second run", [(await rpc(null, "queue_reminders", TOKEN, null, "2030-05-10T16:00:00Z")).booking_reminders, run.result], [0, { sent: 0, failed: 0 }]);

// ---------------------------------------------------- failure and retry
await wipe();
await q("bob", "insert into public.squawks (group_id, author_id, message) values ($1,$2,'will fail first')", [G, U.bob]);
await rpc("cara", "set_notification_preferences", G, { chat_message: true });
await q("bob", "insert into public.squawks (group_id, author_id, message) values ($1,$2,'will fail first too')", [G, U.bob]);
const failing = await flushQueue({
  claim: async (limit) => (await q(null, "select * from public.claim_notifications($1, $2)", [TOKEN, limit])),
  markSent: async (id) => { await rpc(null, "mark_notification_sent", TOKEN, id); },
  markFailed: async (id, error) => { await rpc(null, "mark_notification_failed", TOKEN, id, error); },
  post: async () => ({ ok: false, error: "Resend answered 503" }),
  sleep: async () => {},
  siteUrl: "https://blocktime.group",
}, 10);
await db.exec("reset role");
check("when the email service fails, the email stays queued with the reason", [failing, (await db.query("select attempts, last_error, sent_at from public.notification_outbox")).rows], [{ sent: 0, failed: 1 }, [{ attempts: 1, last_error: "Resend answered 503", sent_at: null }]]);
await db.exec("update public.notification_outbox set last_attempt_at = now() - interval '5 minutes'");
run = await runSender();
check("and a later attempt delivers it", [run.result, (await db.query("select sent_at is not null s from public.notification_outbox")).rows], [{ sent: 1, failed: 0 }, [{ s: true }]]);

h.finish();
