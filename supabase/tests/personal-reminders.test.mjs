// Personal reminders (migration 0031): dates that belong to a person (medical, ratings, their own additions).
// Checks that only the owner can see or change them (not another member, not a group admin, not an outsider,
// not anonymous), the three starter items are created once and in order, the warning text cannot be set or
// changed by the app's users, the limits, and that they go with the account.
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "eve");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111"; // alice admin, bob and cara members
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values ('${G1}','one','Group One','G-ONE');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($1,$4,'member','Cara')`,
  [G1, U.alice, U.bob, U.cara],
);

const mine = (user) => q(user, "select label, due_date::text as due, position, expired_text from public.personal_reminders order by position");
const STARTERS = [
  { label: "Medical", due: null, position: 1, expired_text: null },
  { label: "SEP/MEP Rating", due: null, position: 2, expired_text: null },
  { label: "IR/IMC Rating", due: null, position: 3, expired_text: "EXPIRED - DO NOT FLY IMC!" },
];

// ------------------------------------------------------------------------------ the starter items
check("nobody has any reminders before opening the page", await mine("alice"), []);
check("anonymous cannot create starter items", (await rpc(null, "ensure_personal_reminders")).thrown?.includes("permission denied") ?? false, true);
check("opening the page creates the three starter items", result(await rpc("alice", "ensure_personal_reminders")), "ok");
check("...Medical, SEP/MEP Rating and IR/IMC Rating in that order, no dates, the IMC warning on the last", await mine("alice"), STARTERS);
check("opening it again changes nothing", [(await rpc("alice", "ensure_personal_reminders")).created, (await mine("alice")).length], [false, 3]);

// ----------------------------------------------------------------------------------- privacy
await rpc("bob", "ensure_personal_reminders");
await q("bob", "update public.personal_reminders set due_date = '2028-05-24' where label = 'Medical'");
check("each person has their own, and only theirs", [(await mine("alice")).map((r) => r.due), (await mine("bob")).map((r) => r.due)], [[null, null, null], ["2028-05-24", null, null]]);
check("a group admin cannot see a member's reminders (nor another member)", [(await q("alice", "select count(*)::int n from public.personal_reminders where user_id = $1", [U.bob]))[0].n, (await q("cara", "select count(*)::int n from public.personal_reminders where user_id = $1", [U.bob]))[0].n], [0, 0]);
check("someone with no account in the group sees nothing either", (await q("eve", "select count(*)::int n from public.personal_reminders"))[0].n, 0);
check("anonymous sees nothing", (await q(null, "select count(*)::int n from public.personal_reminders")).thrown !== undefined || (await q(null, "select * from public.personal_reminders")).length === 0, true);

check("nobody changes someone else's reminder", (await q("alice", "update public.personal_reminders set due_date = '2030-01-01' where user_id = $1 returning id", [U.bob])).length, 0);
check("nobody deletes someone else's reminder", (await q("alice", "delete from public.personal_reminders where user_id = $1 returning id", [U.bob])).length, 0);
check("nobody adds a reminder to someone else", (await q("alice", "insert into public.personal_reminders (user_id, label) values ($1, 'Planted')", [U.bob])).thrown?.includes("row-level security") ?? false, true);
check("Bob's reminders are untouched by all of that", (await mine("bob")).map((r) => r.due), ["2028-05-24", null, null]);
check("a reminder cannot be handed to another person", (await q("bob", "update public.personal_reminders set user_id = $1 where label = 'Medical' returning id", [U.alice])).thrown !== undefined, true);

// ------------------------------------------------------------------------------ own changes
let res = await q("alice", "insert into public.personal_reminders (user_id, label, due_date) values ($1, '  First aid course  ', '2027-09-01') returning label, position", [U.alice]);
check("a person adds their own: trimmed, at the end", res, [{ label: "First aid course", position: 4 }]);
res = await q("alice", "update public.personal_reminders set label = 'Class rating', due_date = '2027-10-10' where label = 'First aid course' returning label, due_date::text as due");
check("...renames it and sets its date", res, [{ label: "Class rating", due: "2027-10-10" }]);
res = await q("alice", "update public.personal_reminders set due_date = '2026-12-31' where label = 'SEP/MEP Rating' returning due_date::text as due");
check("...and changes a starter item's date", res, [{ due: "2026-12-31" }]);
res = await q("alice", "delete from public.personal_reminders where label = 'Class rating' returning label");
check("...and deletes their own", res, [{ label: "Class rating" }]);

// ------------------------------------------------------------ the warning text is not theirs to set
res = await q("alice", "insert into public.personal_reminders (user_id, label, expired_text) values ($1, 'Mine', 'Anything I like') returning expired_text", [U.alice]);
check("a person cannot give a new reminder a warning text", res, [{ expired_text: null }]);
res = await q("alice", "update public.personal_reminders set expired_text = 'Changed' where label = 'IR/IMC Rating' returning expired_text");
check("...nor change the starter item's warning text", res, [{ expired_text: "EXPIRED - DO NOT FLY IMC!" }]);
res = await q("alice", "update public.personal_reminders set expired_text = 'Invented' where label = 'Medical' returning expired_text");
check("...nor add one to another item", res, [{ expired_text: null }]);
await q("alice", "delete from public.personal_reminders where label = 'Mine'");

// ---------------------------------------------------------------------------------- limits
const add = (user, label) => q(user, "insert into public.personal_reminders (user_id, label) values ($1, $2) returning id", [U[user], label]);
check("an empty name is refused", (await add("alice", "   ")).thrown !== undefined, true);
check("a 61-character name is refused", (await add("alice", "x".repeat(61))).thrown !== undefined, true);
check("a 60-character name is fine", (await add("alice", "y".repeat(60))).length, 1);
await db.exec("reset role");
const have = (await db.query("select count(*)::int n from public.personal_reminders where user_id = $1", [U.alice])).rows[0].n;
for (let i = have; i < 30; i++) await db.query("insert into public.personal_reminders (user_id, label) values ($1, $2)", [U.alice, `Filler ${i}`]);
check("the 31st is refused with the limit message", String((await add("alice", "One too many")).thrown ?? "").includes("personal_reminders_limit"), true);
check("another person's limit is their own", (await add("bob", "Bob's own")).length, 1);

// ------------------------------------- deleting them all does not bring the starter items back
await q("bob", "delete from public.personal_reminders");
check("a person who deletes everything...", (await mine("bob")).length, 0);
check("...does not get the starter items again", [(await rpc("bob", "ensure_personal_reminders")).created, (await mine("bob")).length], [false, 0]);

// ------------------------------------------------------------------- the seed table is internal
{
  await rpc("alice", "ensure_personal_reminders");
  const read = await q("alice", "select * from public.personal_reminder_seed");
  const write = await q("alice", "insert into public.personal_reminder_seed (user_id) values ($1)", [U.cara]);
  check("the seed table cannot be read or written by the app's users (no rows, no writes)", [Array.isArray(read) ? read.length : "refused", write.thrown !== undefined], [Array.isArray(read) && read.length === 0 ? 0 : "refused", true]);
}

// --------------------------------------------------------------- they go with the account
await db.exec("reset role");
await rpc("cara", "ensure_personal_reminders");
await db.exec("reset role");
await db.query("delete from auth.users where id = $1", [U.cara]).catch(() => null);
check("deleting an account deletes the person's reminders and seed record", [
  (await db.query("select count(*)::int n from public.personal_reminders where user_id = $1", [U.cara])).rows[0].n,
  (await db.query("select count(*)::int n from public.personal_reminder_seed where user_id = $1", [U.cara])).rows[0].n,
], [0, 0]);

// ---------------------------------------------------------------- deleting a group changes nothing
await db.exec(`delete from public.groups where id = '${G1}'`);
check("deleting a group does not touch anyone's personal reminders", (await mine("alice")).length > 0, true);

h.finish();
