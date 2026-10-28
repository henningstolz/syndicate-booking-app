// Group export test (migration 0027): who may start an export, the limit, the log, and that a
// whole group can be deleted (the manual deletion routine relies on it). Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "eve", "zed");
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

const exportFor = (user, group = G1) => rpc(user, "log_group_export", group);
const logged = async (group = G1) => { await db.exec("reset role"); return (await db.query("select count(*)::int n from public.export_log where group_id = $1", [group])).rows[0].n; };

check("a group admin may export", result(await exportFor("alice")), "ok");
check("...and it is logged", await logged(), 1);
await db.exec("reset role");
const row = (await db.query("select group_id, user_id from public.export_log")).rows[0];
check("...with the group and the person, nothing else", [row.group_id, row.user_id], [G1, U.alice]);
check("a plain member may not", result(await exportFor("bob")), "not_allowed");
check("an admin of another group may not export this one", result(await exportFor("eve")), "not_allowed");
check("a signed-in outsider may not", result(await exportFor("zed")), "not_allowed");
check("anonymous may not even call it", (await rpc(null, "log_group_export", G1)).thrown?.includes("permission denied") ?? false, true);
check("an unknown group is refused", result(await exportFor("alice", "99999999-9999-9999-9999-999999999999")), "not_allowed");
check("refusals are not logged", await logged(), 1);

for (let i = 2; i <= 5; i++) check(`export ${i} of 5 within the hour is allowed`, result(await exportFor("alice")), "ok");
check("the sixth within the hour is refused", result(await exportFor("alice")), "rate_limited");
check("...and not logged", await logged(), 5);
check("another group is not affected", result(await exportFor("eve", G2)), "ok");
await db.exec("reset role");
await db.query("update public.export_log set created_at = now() - interval '2 hours' where group_id = $1", [G1]);
check("an hour later the group can export again", result(await exportFor("alice")), "ok");

await db.exec("reset role");
await db.query("update public.group_members set removed_at = now() where user_id = $1", [U.alice]);
check("a removed admin may not", result(await exportFor("alice")), "not_allowed");
await db.exec("reset role");
await db.query("update public.group_members set removed_at = null where user_id = $1", [U.alice]);

check("nobody reads or writes the log through the app", [
  (await h.q("alice", "select * from public.export_log")).thrown !== undefined || (await h.q("alice", "select * from public.export_log")).length === 0,
  (await h.q("alice", "insert into public.export_log (group_id, user_id) values ($1, $2) returning id", [G1, U.alice])).thrown !== undefined || false,
], [true, true]);

// ------------------------------------------------ deleting a whole group
// The manual deletion routine (docs/runbook-group-deletion.md) is one "delete from groups".
// Every link to a group must therefore remove or detach what points at it, never block it.
await db.exec("reset role");
const links = (await db.query(`
  select conrelid::regclass::text as t, confdeltype as rule
  from pg_constraint where contype = 'f' and confrelid = 'public.groups'::regclass order by 1`)).rows;
check("every table that points at a group removes or detaches its rows when the group is deleted", links.filter((l) => l.rule !== "c" && l.rule !== "n"), []);

// A group with something in every table that has a group_id.
const G3 = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values ('${G3}','three','Group Three','G-TRE')`);
await db.query(`insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Zed')`, [G3, U.zed]);
await db.query(`insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,'2026-12-01 10:00+00','2026-12-01 12:00+00')`, [G3, U.zed]);
await db.query(`insert into public.squawks (group_id, author_id, message) values ($1,$2,'hello')`, [G3, U.zed]);
await db.query(`insert into public.invites (group_id, role, created_by) values ($1,'member',$2)`, [G3, U.zed]);
await db.query(`insert into public.feedback (group_id, user_id, category, message) values ($1,$2,'idea','a message')`, [G3, U.zed]);
await db.query(`insert into public.documents (group_id, uploaded_by, title, category, file_name, content_type, size_bytes, storage_path) values ($1,$2,'Doc','general','a.pdf','application/pdf',10,$3)`, [G3, U.zed, `${G3}/a.pdf`]);
await db.query(`insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,'2026-12-01',1000,2000,$2)`, [G3, U.zed]);
await db.query(`insert into public.terms_acceptances (user_id, group_id, document, version) values ($1,$2,'terms','v1')`, [U.zed, G3]);
await db.query(`insert into public.export_log (group_id, user_id) values ($1,$2)`, [G3, U.zed]);
const planEventsBefore = (await db.query("select count(*)::int n from public.plan_events where group_id = $1", [G3])).rows[0].n;

try { await db.exec(`delete from public.groups where id = '${G3}'`); check("a group with data in many tables can be deleted", true, true); }
catch (e) { check("a group with data in many tables can be deleted", e.message, "no error"); }

const tables = (await db.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'group_id' and table_name <> 'plan_events' order by 1`)).rows.map((r) => r.table_name);
const left = [];
for (const t of tables) {
  const n = (await db.query(`select count(*)::int n from public."${t}" where group_id = $1`, [G3])).rows[0].n;
  if (n > 0) left.push(`${t}:${n}`);
}
check("nothing of the group is left in any table", left, []);
check("the history keeps its ids (plan_events is append-only)", (await db.query("select count(*)::int n from public.plan_events where group_id = $1", [G3])).rows[0].n, planEventsBefore);
check("the person's own acceptance stays, detached from the group", (await db.query("select count(*)::int n, count(group_id)::int g from public.terms_acceptances where user_id = $1", [U.zed])).rows[0], { n: 1, g: 0 });
check("the other groups are untouched", (await db.query("select count(*)::int n from public.groups where id in ($1,$2)", [G1, G2])).rows[0].n, 2);

h.finish();
