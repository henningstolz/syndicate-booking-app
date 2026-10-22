// Feedback database test: who may send, what is checked, the limit of 5 an hour, and that
// nobody can read the messages through the app. Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "eve");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values
    ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($4,$5,'admin','Eve')`,
  [G1, U.alice, U.bob, G2, U.eve],
);

const send = (user, message, category = "idea", group = G1, page = "/one/calendar", ua = "Mozilla/5.0 (iPhone)") =>
  rpc(user, "submit_feedback", group, category, message, page, ua);

check("a member sends feedback", result(await send("bob", "  The calendar is great, could it show weeks?  ")), "ok");
await db.exec("reset role");
const row = (await db.query("select * from public.feedback")).rows[0];
check("the message is trimmed and kept with who, where and what", [row.message, row.category, row.user_id === U.bob, row.group_id, row.page, row.user_agent, row.emailed_at], ["The calendar is great, could it show weeks?", "idea", true, G1, "/one/calendar", "Mozilla/5.0 (iPhone)", null]);
check("an outsider cannot send for the group", result(await send("eve", "hello there", "bug", G1)), "not_allowed");
check("anonymous cannot", (await rpc(null, "submit_feedback", G1, "bug", "hello there", null, null)).thrown?.includes("permission denied") ?? false, true);
check("the category must be known", [result(await send("bob", "hello there", "complaint")), result(await send("bob", "hello there", null))], ["category_invalid", "category_invalid"]);
check("a message is needed, and not a huge one", [result(await send("bob", "  ")), result(await send("bob", "ab")), result(await send("bob", "x".repeat(2001)))], ["message_required", "message_required", "message_too_long"]);
check("a message of 2000 characters is fine", result(await send("bob", "x".repeat(2000), "other")), "ok");
await db.exec("reset role");
check("a very long page and device text are cut, not refused", (await (async () => { const r = await send("bob", "long fields", "bug", G1, "/" + "p".repeat(500), "u".repeat(900)); await db.exec("reset role"); const l = (await db.query("select char_length(page) p, char_length(user_agent) u from public.feedback where message = 'long fields'")).rows[0]; return [result(r), l.p, l.u]; })()), ["ok", 200, 300]);

// ---------------------------------------------------------------- the limit
await db.exec("reset role");
await db.query("delete from public.feedback");
for (let i = 1; i <= 5; i++) check(`message ${i} of 5 goes through`, result(await send("bob", `message number ${i}`)), "ok");
check("the sixth within the hour is refused", result(await send("bob", "one too many")), "rate_limited");
check("another person is not affected", result(await send("alice", "my own message")), "ok");
await db.exec("reset role");
await db.query("update public.feedback set created_at = now() - interval '2 hours' where user_id = $1", [U.bob]);
check("an hour later Bob can send again", result(await send("bob", "back again")), "ok");

// -------------------------------------------------------------- privacy
check("a member cannot read the messages, not even their own", [(await q("bob", "select * from public.feedback")).thrown !== undefined || (await q("bob", "select * from public.feedback")).length === 0, (await q("alice", "select * from public.feedback")).thrown !== undefined || (await q("alice", "select * from public.feedback")).length === 0], [true, true]);
const blocked = (r) => r.thrown !== undefined || r.length === 0; // refused outright, or no row is visible to change
check("nobody writes the table directly", [blocked(await q("bob", "insert into public.feedback (group_id, user_id, category, message) values ($1,$2,'bug','sneaky one') returning id", [G1, U.bob])), blocked(await q("bob", "update public.feedback set message = 'changed' returning id")), blocked(await q("bob", "delete from public.feedback returning id"))], [true, true, true]);
await db.exec("reset role");
check("...and nothing was changed", (await db.query("select count(*)::int n from public.feedback where message in ('sneaky one', 'changed')")).rows[0].n, 0);

// ------------------------------------------------------------ emailed mark
await db.exec("reset role");
const mine = (await db.query("select id from public.feedback where message = 'back again'")).rows[0].id;
check("another person cannot mark it", result(await rpc("alice", "mark_feedback_emailed", mine)), "not_found");
check("the sender marks their own as emailed", result(await rpc("bob", "mark_feedback_emailed", mine)), "ok");
check("only once", result(await rpc("bob", "mark_feedback_emailed", mine)), "not_found");
check("anonymous cannot", (await rpc(null, "mark_feedback_emailed", mine)).thrown?.includes("permission denied") ?? false, true);
await db.exec("reset role");
check("it is recorded", (await db.query("select emailed_at is not null as sent from public.feedback where id = $1", [mine])).rows[0].sent, true);

h.finish();
