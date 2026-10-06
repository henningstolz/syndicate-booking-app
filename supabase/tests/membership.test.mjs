// Database rules test: applies every migration to a throwaway in-memory
// Postgres (PGlite) and checks the group/member/invite rules, including the
// "a group always keeps an admin" guard. Run with: npm run test:db
// It stands in for Supabase's auth.users and auth.uid(); it never touches the
// real database.
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, as, rpc, q, check, result } = h;

await h.setup();
// Apply everything before 0010 first, to prove 0010 upgrades an existing database.
await h.migrate({ before: "0010" });

// Real-looking state before 0010: an old unused invite.
await h.addUsers("alice", "bob", "cara", "dan");
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values ('11111111-1111-1111-1111-111111111111','t','Test','G-TEST') on conflict do nothing;`);
const G = (await db.query("select id from public.groups where slug='t'")).rows[0].id;
await db.query("insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Alice'),($1,$3,'member','Bob'),($1,$4,'admin','Cara')", [G, U.alice, U.bob, U.cara]);
const oldInvite = (await db.query("insert into public.invites (group_id, role, created_by) values ($1,'member',$2) returning id", [G, U.alice])).rows[0].id;

await h.migrate({ only: "0010" });
console.log("migrations 0001-0010 applied");

// --- roles -------------------------------------------------------------
check("member cannot promote anyone", result(await rpc("bob", "set_member_role", G, U.bob, "admin")), "not_allowed");
check("admin promotes bob", result(await rpc("alice", "set_member_role", G, U.bob, "admin")), "ok");
check("admin demotes bob again", result(await rpc("alice", "set_member_role", G, U.bob, "member")), "ok");
check("bad role refused", result(await rpc("alice", "set_member_role", G, U.bob, "owner")), "invalid_role");
check("unknown user not_found", result(await rpc("alice", "set_member_role", G, U.dan, "member")), "not_found");
check("anon cannot call", (await rpc(null, "set_member_role", G, U.bob, "admin")).thrown?.includes("permission denied") ?? false, true);

// --- last-admin guard -------------------------------------------------
check("demote cara (alice stays admin)", result(await rpc("alice", "set_member_role", G, U.cara, "member")), "ok");
check("cannot demote the last admin (self)", result(await rpc("alice", "set_member_role", G, U.alice, "member")), "last_admin");
check("alice cannot leave as last admin", result(await rpc("alice", "leave_group", G)), "last_admin");
check("alice cannot remove herself via remove_member", result(await rpc("alice", "remove_member", G, U.alice)), "use_leave");
check("promote cara back", result(await rpc("alice", "set_member_role", G, U.cara, "admin")), "ok");
check("now alice may demote herself", result(await rpc("alice", "set_member_role", G, U.alice, "member")), "ok");
check("alice (now member) cannot manage", result(await rpc("alice", "set_member_role", G, U.cara, "member")), "not_allowed");
check("cara demotes... alice is member, cara last admin", result(await rpc("cara", "set_member_role", G, U.cara, "member")), "last_admin");
await rpc("cara", "set_member_role", G, U.alice, "admin");

// --- bookings are cancelled on removal ---------------------------------
await as(null); await db.exec("reset role");
await db.query(`insert into public.bookings (group_id, member_id, starts_at, ends_at) values
  ($1,$2, now() + interval '2 days', now() + interval '2 days 2 hours'),
  ($1,$2, now() - interval '3 days', now() - interval '3 days' + interval '2 hours'),
  ($1,$3, now() + interval '5 days', now() + interval '5 days 2 hours')`, [G, U.bob, U.cara]);
const rem = await rpc("alice", "remove_member", G, U.bob);
check("remove bob", rem, { result: "ok", cancelled_bookings: 1 });
await db.exec("reset role");
check("bob's future booking cancelled, past kept, cara's untouched",
  (await db.query("select member_id=$1 as bob, status from public.bookings order by starts_at", [U.bob])).rows.map((r) => `${r.bob ? "bob" : "cara"}:${r.status}`),
  ["bob:confirmed", "bob:cancelled", "cara:confirmed"]);
check("bob's row still exists (history keeps his name)", (await db.query("select display_name, removed_at is not null as gone from public.group_members where user_id=$1", [U.bob])).rows[0], { display_name: "Bob", gone: true });
check("removed bob is no longer a member", (await q("bob", "select public.is_group_member($1) as m", [G]))[0].m, false);
check("removed bob sees no group", (await q("bob", "select id from public.groups")).length, 0);
check("removed bob sees no bookings", (await q("bob", "select id from public.bookings")).length, 0);
check("active member still sees removed rows (for history names)", (await q("cara", "select count(*)::int as n from public.group_members where group_id=$1", [G]))[0].n, 3);
check("removed bob cannot remove others", result(await rpc("bob", "remove_member", G, U.cara)), "not_allowed");
check("removed bob cannot post a booking", (await q("bob", "insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2, now()+interval '9 days', now()+interval '9 days 1 hour')", [G, U.bob])).thrown?.includes("row-level security") ?? false, true);
check("remove non-member is not_found", result(await rpc("alice", "remove_member", G, U.bob)), "not_found");

// --- invites -----------------------------------------------------------
await as("alice");
const mk = async (label, extra = "") => (await db.query(`insert into public.invites (group_id, role, created_by, label ${extra ? ", " + extra.split("=")[0] : ""}) values ($1,'member',$2,$3 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [G, U.alice, label])).rows[0].id;
const inv = await mk("Dan");
check("new invite expires in ~14 days", (await q(null, "select public.get_invite_info($1) as i", [inv]))[0].i.replace(/[()]/g, "").split(",").slice(-2).join(","), "Dan,valid");
check("old pre-migration invite is valid (got default expiry)", (await q(null, "select is_valid from public.get_invite_info($1)", [oldInvite]))[0].is_valid, true);
check("anon can read invite info", (await q(null, "select group_name, label, status from public.get_invite_info($1)", [inv]))[0], { group_name: "Test", label: "Dan", status: "valid" });

check("anon cannot accept", (await rpc(null, "accept_invite", inv, "Dan")).thrown?.includes("permission denied") ?? false, true);
check("empty name refused", result(await rpc("dan", "accept_invite", inv, "   ")), "name_required");
check("long name refused", result(await rpc("dan", "accept_invite", inv, "x".repeat(61))), "name_too_long");
check("unknown invite", result(await rpc("dan", "accept_invite", "00000000-0000-0000-0000-000000000000", "Dan")), "invalid");

const dan1 = await rpc("dan", "accept_invite", inv, "  Dan  ");
check("dan joins", dan1, { result: "ok", group_slug: "t" });
await db.exec("reset role");
check("name trimmed, role from invite", (await db.query("select display_name, role from public.group_members where user_id=$1", [U.dan])).rows[0], { display_name: "Dan", role: "member" });
check("invite used", (await q(null, "select status from public.get_invite_info($1)", [inv]))[0].status, "used");
check("used invite cannot be reused", result(await rpc("bob", "accept_invite", inv, "Bob")), "used");
check("already-member is told so and invite stays free", result(await rpc("dan", "accept_invite", await (async () => { await as("alice"); return mk("spare"); })(), "Dan")), "already_member");

await as("alice");
const inv2 = await mk("Bob again");
check("revoke by non-admin refused", result(await rpc("dan", "revoke_invite", inv2)), "not_allowed");
check("revoke by admin", result(await rpc("alice", "revoke_invite", inv2)), "ok");
check("revoked invite cannot be accepted", result(await rpc("bob", "accept_invite", inv2, "Bob")), "revoked");
check("status says revoked", (await q(null, "select status, is_valid from public.get_invite_info($1)", [inv2]))[0], { status: "revoked", is_valid: false });
check("cannot revoke a used invite", result(await rpc("alice", "revoke_invite", inv)), "already_used");

await as("alice");
const inv3 = await mk("Expired one");
await db.exec("reset role");
await db.query("update public.invites set expires_at = now() - interval '1 minute' where id=$1", [inv3]);
check("expired invite refused", result(await rpc("bob", "accept_invite", inv3, "Bob")), "expired");
check("status says expired", (await q(null, "select status from public.get_invite_info($1)", [inv3]))[0].status, "expired");

// --- coming back after removal, role comes from the invite -------------
await as("alice");
const inv4 = await mk("Bob returns");
await db.exec("reset role");
await db.query("update public.invites set role='admin' where id=$1", [inv4]);
check("removed bob rejoins through a new invite", result(await rpc("bob", "accept_invite", inv4, "Bobby")), "ok");
await db.exec("reset role");
check("bob reactivated: same row, new name, invite's role", (await db.query("select display_name, role, removed_at from public.group_members where user_id=$1", [U.bob])).rows, [{ display_name: "Bobby", role: "admin", removed_at: null }]);
check("exactly one member row for bob", (await db.query("select count(*)::int n from public.group_members where user_id=$1", [U.bob])).rows[0].n, 1);
check("bob is a member again", (await q("bob", "select public.is_group_member($1) m", [G]))[0].m, true);

// --- leaving and renaming ----------------------------------------------
check("dan leaves", result(await rpc("dan", "leave_group", G)), "ok");
check("dan cannot leave twice", result(await rpc("dan", "leave_group", G)), "not_found");
check("rename self", result(await rpc("cara", "set_my_display_name", G, " Cara B ")), "ok");
await db.exec("reset role");
check("renamed and trimmed", (await db.query("select display_name from public.group_members where user_id=$1", [U.cara])).rows[0].display_name, "Cara B");
check("empty rename refused", result(await rpc("cara", "set_my_display_name", G, "")), "name_required");
check("removed dan cannot rename", result(await rpc("dan", "set_my_display_name", G, "Dan2")), "not_found");

// --- direct table writes stay locked down ------------------------------
check("member cannot UPDATE own role directly", (await q("bob", "update public.group_members set role='admin' where user_id=$1 returning id", [U.bob])).length, 0);
check("member cannot DELETE members directly", (await q("bob", "delete from public.group_members where user_id=$1 returning id", [U.cara])).length, 0);
check("cannot self-insert into an existing group as admin", (await q("dan", "insert into public.group_members (group_id,user_id,role) values ($1,$2,'admin')", [G, U.dan])).thrown?.includes("row-level security") ?? false, true);

h.finish();
