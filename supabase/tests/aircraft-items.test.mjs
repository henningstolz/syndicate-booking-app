// The aircraft equipment list (life raft, first aid kit, ...): every group starts with four items,
// members read them, only the group's admins change them, groups cannot see or touch each other's,
// at most 30 per group, the carry-over from the old fixed columns keeps dates and already-sent
// reminders, and the daily reminder job reads the items (custom ones included).
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, q, rpc, check } = h;

await h.setup();
await h.migrate({ before: "0028" });
await h.addUsers("alice", "bob", "cara", "dan");

const G1 = "11111111-1111-1111-1111-111111111111"; // alice admin, bob member
const G2 = "22222222-2222-2222-2222-222222222222"; // dan admin, cara member
const G3 = "33333333-3333-3333-3333-333333333333"; // made BEFORE the migration, with old dates

// ------------------------------------------- a group that exists before the migration
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration, life_raft_due, life_vests_due, fire_extinguisher_due)
  values ('${G3}','three','Group Three','G-THRE','2028-05-25','2028-06-01','2028-06-10');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Alice'), ($1,$3,'member','Bob')`,
  [G3, U.alice, U.bob],
);
// Reminders already sent before the migration: the raft's 30-day one and the extinguisher's.
await db.exec(`insert into public.reminder_log (group_id, key) values
  ('${G3}','aircraft:life_raft:2028-05-25:30'), ('${G3}','aircraft:fire_extinguisher:2028-06-10:30'), ('${G3}','booking:abc'), ('${G3}','aircraft:annual:2028-05-20:30')`);

await h.migrate({ only: "0028" });
console.log("migration 0028 applied");

await db.exec("reset role");
const items = async (group) => {
  await db.exec("reset role");
  return (await db.query("select label, due_date::text as due, position from public.aircraft_items where group_id = $1 order by position", [group])).rows;
};

check("an existing group gets the four items in order, dates carried over, the first aid kit without a date",
  await items(G3),
  [
    { label: "Life raft", due: "2028-05-25", position: 1 },
    { label: "Life vests", due: "2028-06-01", position: 2 },
    { label: "Fire extinguisher", due: "2028-06-10", position: 3 },
    { label: "First aid kit", due: null, position: 4 },
  ]);
const keys = (await db.query("select key from public.reminder_log where group_id = $1 order by key", [G3])).rows.map((r) => r.key);
const rid = (await db.query("select id from public.aircraft_items where group_id = $1 and label = 'Life raft'", [G3])).rows[0].id;
const eid = (await db.query("select id from public.aircraft_items where group_id = $1 and label = 'Fire extinguisher'", [G3])).rows[0].id;
check("reminders already sent are re-pointed at the new rows; others are left alone",
  keys, [`aircraft:${eid}:2028-06-10:30`, "aircraft:annual:2028-05-20:30", `aircraft:${rid}:2028-05-25:30`, "booking:abc"].sort());

// ------------------------------------------------ the reminder job and the carried-over reminders
const TOKEN = "r".repeat(48);
await db.query("insert into public.notification_worker (token_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))", [TOKEN]);
const run = async (now) => rpc(null, "queue_reminders", TOKEN, null, now);

// 2028-05-15: the raft (10 days) and the extinguisher (26 days) are in their 30-day window, but both
// reminders were already sent before the migration, so they are not sent again. The life vests (due
// 1 June, 17 days) had no reminder yet, so only they are queued: one email per member.
const itemsQueued = async () => {
  await db.exec("reset role");
  return (await db.query(
    `select o.payload from public.notification_outbox o join auth.users u on u.id = o.recipient_user_id
     where o.event = 'aircraft_reminder' order by u.email`)).rows.map((x) => x.payload.items.map((i) => i.item));
};
let r = await run("2028-05-15T16:00:00Z");
check("reminders sent before the migration are not sent twice (only the vests are new)",
  [r.aircraft_reminders, await itemsQueued()], [2, [["Life vests"], ["Life vests"]]]);

// A new item with a date is reminded like the built-in ones, in the group's order.
await db.exec("delete from public.notification_outbox");
await db.exec(`delete from public.reminder_log where key like 'aircraft:%'`);
await db.exec(`update public.aircraft_items set due_date = '2028-06-01' where group_id = '${G3}' and label = 'First aid kit'`);
r = await run("2028-05-20T16:00:00Z"); // raft in 5 days (7-stage), vests and first aid kit in 12, extinguisher in 21
check("a new item is reminded like the built-in ones, in the group's order",
  (await itemsQueued())[0].join(","), "Life raft,Life vests,Fire extinguisher,First aid kit");
await db.exec("delete from public.notification_outbox");

// ------------------------------------------------------------- groups made after the migration
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($4,$5,'admin','Dan'), ($4,$6,'member','Cara')`,
  [G1, U.alice, U.bob, G2, U.dan, U.cara],
);
check("a new group gets the four starter items, no dates",
  await items(G1), [
    { label: "Life raft", due: null, position: 1 },
    { label: "Life vests", due: null, position: 2 },
    { label: "Fire extinguisher", due: null, position: 3 },
    { label: "First aid kit", due: null, position: 4 },
  ]);

// ------------------------------------------------------------------------------ who can read
const labels = async (user, group) => {
  const rows = await q(user, "select label from public.aircraft_items where group_id = $1 order by position", [group]);
  return Array.isArray(rows) ? rows.map((x) => x.label) : rows;
};
const FOUR = ["Life raft", "Life vests", "Fire extinguisher", "First aid kit"];
check("a member reads the list", await labels("bob", G1), FOUR);
check("an admin reads the list", await labels("alice", G1), FOUR);
check("someone from another group sees nothing of it", await labels("dan", G1), []);
{
  const anon = await labels(null, G1);
  check("a signed-out visitor sees nothing (refused or empty)", Array.isArray(anon) && anon.length > 0 ? anon : "nothing", "nothing");
}

// ----------------------------------------------------------------------------- who can change
const add = (user, group, label, due = null) =>
  q(user, "insert into public.aircraft_items (group_id, label, due_date) values ($1, $2, $3) returning label, position", [group, label, due]);
const ok = (rows) => Array.isArray(rows) && rows.length === 1;

let res = await add("alice", G1, "  Emergency beacon  ", "2027-03-01");
check("an admin adds an item: it is trimmed and goes to the end", ok(res) && [res[0].label, res[0].position], ["Emergency beacon", 5]);
check("a member cannot add one", (await add("bob", G1, "Fire blanket")).thrown !== undefined, true);
check("someone from another group cannot add one", (await add("dan", G1, "Fire blanket")).thrown !== undefined, true);
check("a signed-out visitor cannot add one", (await add(null, G1, "Fire blanket")).thrown !== undefined, true);
check("an admin cannot add one to ANOTHER group", (await add("alice", G2, "Fire blanket")).thrown !== undefined, true);

res = await q("alice", "update public.aircraft_items set label = 'First aid kit (cabin)', due_date = '2027-09-30' where group_id = $1 and label = 'First aid kit' returning label, due_date::text as due", [G1]);
check("an admin renames an item and sets its date", res, [{ label: "First aid kit (cabin)", due: "2027-09-30" }]);
res = await q("bob", "update public.aircraft_items set due_date = '2030-01-01' where group_id = $1 returning id", [G1]);
check("a member's change matches no row", res, []);
res = await q("dan", "update public.aircraft_items set label = 'Hacked' where group_id = $1 returning id", [G1]);
check("another group's admin's change matches no row", res, []);
res = await q("alice", "update public.aircraft_items set group_id = $2 where group_id = $1 and label = 'Life vests' returning id", [G1, G2]);
check("an item cannot be moved to another group, even by an admin of both", res.thrown !== undefined || res.length === 0, true);

res = await q("bob", "delete from public.aircraft_items where group_id = $1 returning id", [G1]);
check("a member cannot delete items", res, []);
res = await q("dan", "delete from public.aircraft_items where group_id = $1 returning id", [G1]);
check("another group's admin cannot delete items", res, []);
res = await q("alice", "delete from public.aircraft_items where group_id = $1 and label = 'Life vests' returning label", [G1]);
check("an admin deletes an item", res, [{ label: "Life vests" }]);
check("the list afterwards", await labels("alice", G1), ["Life raft", "Fire extinguisher", "First aid kit (cabin)", "Emergency beacon"]);
check("the other group's list is untouched", await labels("dan", G2), FOUR);

// ------------------------------------------------------------------------------------- limits
check("an empty name is refused", (await add("alice", G1, "   ")).thrown !== undefined, true);
check("a 61-character name is refused", (await add("alice", G1, "x".repeat(61))).thrown !== undefined, true);
check("a 60-character name is fine", ok(await add("alice", G1, "y".repeat(60))), true);
await db.exec("reset role");
const have = (await db.query("select count(*)::int as n from public.aircraft_items where group_id = $1", [G1])).rows[0].n;
for (let i = have; i < 30; i++) {
  await db.query("insert into public.aircraft_items (group_id, label) values ($1, $2)", [G1, `Filler ${i}`]);
}
const over = await add("alice", G1, "One too many");
check("the 31st item is refused with the limit message", String(over.thrown ?? "").includes("aircraft_items_limit"), true);
check("deleting one makes room again", [(await q("alice", "delete from public.aircraft_items where group_id = $1 and label = 'Filler 10' returning id", [G1])).length, ok(await add("alice", G1, "Room again"))], [1, true]);

// -------------------------------------------------------------------------- deleting a group
await db.exec("reset role");
await db.exec(`delete from public.groups where id = '${G2}'`);
check("deleting a group takes its items with it", (await db.query("select count(*)::int as n from public.aircraft_items where group_id = $1", [G2])).rows[0].n, 0);

h.finish();
