// The two kinds of calendar link (migration 0030): the whole group's bookings ('all', as it has always been)
// and only the member's own ('mine'). Checks that a link made before the migration keeps working as an 'all'
// link, that a member can hold one of each kind at the same time, that "mine" never contains anyone else's
// booking, that replacing or turning off one kind leaves the other alone, that a call without a kind still
// means 'all' (the code from before the migration), and that everything that turned a link off still does.
// Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate({ before: "0030" });
await h.addUsers("alice", "bob", "cara", "eve");

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values
    ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($1,$4,'member','Cara'), ($5,$6,'admin','Eve')`,
  [G1, U.alice, U.bob, U.cara, G2, U.eve],
);
const booking = async (group, who, startsAt, endsAt, o = {}) =>
  (await db.query("insert into public.bookings (group_id, member_id, starts_at, ends_at, note, status) values ($1,$2,$3,$4,$5,$6) returning id", [group, U[who], startsAt, endsAt, o.note ?? null, o.status ?? "confirmed"])).rows[0].id;
const day = (n) => new Date(Date.now() + n * 86400000);
const at = (n, hour) => { const d = day(n); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
await db.exec("reset role");
const b1 = await booking(G1, "alice", at(2, 9), at(2, 11), { note: "Alice's trip" });
const b2 = await booking(G1, "bob", at(3, 9), at(3, 12), { note: "Bob's trip" });
const b3 = await booking(G1, "bob", at(5, 9), at(5, 10));
const bCancelled = await booking(G1, "bob", at(4, 9), at(4, 10), { status: "cancelled" });
const bOld = await booking(G1, "bob", at(-90, 9), at(-90, 10));
const bRecent = await booking(G1, "bob", at(-10, 9), at(-10, 10));
const bOther = await booking(G2, "eve", at(2, 9), at(2, 10), { note: "Secret of group two" });

// ---------------------------------------- a link made BEFORE the migration (the old one-argument function)
check("(before the migration) Bob creates his one link", result(await rpc("bob", "create_calendar_feed", G1)), "ok");
await db.exec("reset role");
const oldToken = (await db.query("select token from public.calendar_feeds where user_id = $1", [U.bob])).rows[0].token;
const bobOldFeed = await rpc(null, "calendar_feed", oldToken);
check("(before) it shows the whole group", bobOldFeed.bookings.length, 4);

await db.exec("reset role");
await h.migrate({ only: "0030" });
console.log("migration 0030 applied");

const feed = (token) => rpc(null, "calendar_feed", token);
const tokenOf = async (user, group, scope) => (await q(user, "select token from public.calendar_feeds where group_id = $1 and scope = $2 and revoked_at is null", [group, scope]))[0]?.token;
const ids = (f) => f.bookings.map((b) => b.id);

check("the existing link becomes an 'all' link and keeps working with the same address", [await tokenOf("bob", G1, "all"), (await feed(oldToken)).scope, ids(await feed(oldToken))], [oldToken, "all", [bRecent, b1, b2, b3]]);
check("...exactly as before: the same bookings, in the same order", ids(await feed(oldToken)), ids(bobOldFeed));

// -------------------------------------------------------------- the code from before the migration
check("a call WITHOUT a kind still means 'all' (replaces the 'all' link)", result(await rpc("bob", "create_calendar_feed", G1)), "ok");
const bobAll = await tokenOf("bob", G1, "all");
check("...a new address, the old one stops", [bobAll !== oldToken, await feed(oldToken)], [true, null]);

// ------------------------------------------------------------------------------------- 'mine'
check("an outsider cannot create one", result(await rpc("eve", "create_calendar_feed", G1, "mine")), "not_allowed");
check("anonymous cannot", (await rpc(null, "create_calendar_feed", G1, "mine")).thrown?.includes("permission denied") ?? false, true);
check("only 'all' or 'mine' are accepted", [result(await rpc("bob", "create_calendar_feed", G1, "everyone")), result(await rpc("bob", "create_calendar_feed", G1, null)), result(await rpc("bob", "create_calendar_feed", G1, ""))], ["scope_invalid", "scope_invalid", "scope_invalid"]);
check("Bob creates his own-bookings link", result(await rpc("bob", "create_calendar_feed", G1, "mine")), "ok");
const bobMine = await tokenOf("bob", G1, "mine");
check("it is a different 64-character link from the whole-group one", [/^[0-9a-f]{64}$/.test(bobMine), bobMine !== bobAll], [true, true]);

let f = await feed(bobMine);
check("the own-bookings feed holds only Bob's confirmed bookings from 60 days back, in order", [f.scope, ids(f)], ["mine", [bRecent, b2, b3]]);
check("...no one else's booking or note, no cancelled or very old one, nothing of another group", [
  f.bookings.some((b) => b.id === b1), JSON.stringify(f).includes("Alice's trip"), f.bookings.some((b) => b.id === bCancelled), f.bookings.some((b) => b.id === bOld),
  f.bookings.some((b) => b.id === bOther), JSON.stringify(f).includes("Secret of group two"),
], [false, false, false, false, false, false]);
check("...every booking in it is marked as his own", f.bookings.every((b) => b.mine), true);
check("...it names the group and aircraft", [f.group_name, f.group_slug, f.registration], ["Group One", "one", "G-ONE"]);
check("...and holds no member ids or addresses", [JSON.stringify(f).includes(U.alice), JSON.stringify(f).includes("@")], [false, false]);
check("the whole-group link still shows everything", ids(await feed(bobAll)), [bRecent, b1, b2, b3]);
check("a member with no bookings gets an empty own-bookings feed", [result(await rpc("cara", "create_calendar_feed", G1, "mine")), (await feed(await tokenOf("cara", G1, "mine"))).bookings], ["ok", []]);

// ------------------------------------------ both kinds together, and each on its own
await db.exec("reset role");
check("a member holds one link of each kind at the same time", (await db.query("select count(*)::int n from public.calendar_feeds where user_id = $1 and revoked_at is null", [U.bob])).rows[0].n, 2);
check("a member sees only their own links (not even an admin sees another's)", [
  (await q("bob", "select count(*)::int n from public.calendar_feeds where revoked_at is null"))[0].n,
  (await q("alice", "select count(*)::int n from public.calendar_feeds"))[0].n,
  (await q("bob", "select scope from public.calendar_feeds where revoked_at is null order by scope")).map((r) => r.scope),
], [2, 0, ["all", "mine"]]);
check("nobody writes the table directly", [(await q("bob", "update public.calendar_feeds set scope = 'all' returning id")).length, (await q("bob", "insert into public.calendar_feeds (group_id, user_id, token, scope) values ($1,$2,$3,'mine')", [G1, U.bob, "a".repeat(64)])).thrown?.includes("row-level security") ?? false], [0, true]);

check("making a new 'mine' link replaces only the 'mine' link", result(await rpc("bob", "create_calendar_feed", G1, "mine")), "ok");
const bobMine2 = await tokenOf("bob", G1, "mine");
check("...the old own-bookings address stops, the new one works, the whole-group one is untouched", [await feed(bobMine), (await feed(bobMine2)).scope, (await feed(bobAll)).scope], [null, "mine", "all"]);
await db.exec("reset role");
check("still one active link per member, group and kind", (await db.query("select count(*)::int n from public.calendar_feeds where user_id = $1 and revoked_at is null", [U.bob])).rows[0].n, 2);

check("turning off 'mine' leaves the whole-group link working", [result(await rpc("bob", "revoke_calendar_feed", G1, "mine")), await feed(bobMine2), (await feed(bobAll)).scope], ["ok", null, "all"]);
check("turning it off again says there is none", result(await rpc("bob", "revoke_calendar_feed", G1, "mine")), "no_feed");
check("an outsider cannot turn off someone's link", result(await rpc("eve", "revoke_calendar_feed", G1, "mine")), "not_allowed");
check("a bad kind is refused when turning off too", result(await rpc("bob", "revoke_calendar_feed", G1, "everyone")), "scope_invalid");
check("a call without a kind turns off the 'all' link (as before)", [result(await rpc("bob", "revoke_calendar_feed", G1)), await feed(bobAll)], ["ok", null]);

// ---------------------------------------------------------------- the feed follows the bookings
await rpc("bob", "create_calendar_feed", G1, "mine");
const mineToken = await tokenOf("bob", G1, "mine");
await db.exec("reset role");
await db.query("update public.bookings set status = 'cancelled' where id = $1", [b2]);
check("a cancelled booking drops out of the own-bookings feed", ids(await feed(mineToken)), [bRecent, b3]);
await db.exec("reset role");
await db.query("update public.bookings set note = 'New note' where id = $1", [b3]);
check("an edited note shows at the next refresh", (await feed(mineToken)).bookings.find((b) => b.id === b3).note, "New note");

// ---------------------------------------------------------------------- leaving the group ends both
await rpc("bob", "create_calendar_feed", G1, "all");
const allToken = await tokenOf("bob", G1, "all");
await db.exec("reset role");
await db.query("update public.group_members set removed_at = now() where user_id = $1 and group_id = $2", [U.bob, G1]);
check("a removed member's links of both kinds stop working", [await feed(mineToken), await feed(allToken)], [null, null]);
await db.exec("reset role");
await db.query("update public.group_members set removed_at = null where user_id = $1 and group_id = $2", [U.bob, G1]);
check("...and work again if they are re-added", [(await feed(mineToken)) !== null, (await feed(allToken)) !== null], [true, true]);

// ------------------------------------------------------ the health check's all-zero token is still harmless
check("the uptime monitor's all-zero token still gets null", await feed("0".repeat(64)), null);

// ------------------------------------------------------------------------------- deleting a group
await db.exec("reset role");
await db.exec(`delete from public.groups where id = '${G1}'`);
check("deleting a group takes its links of both kinds with it", (await db.query("select count(*)::int n from public.calendar_feeds where group_id = $1", [G1])).rows[0].n, 0);

h.finish();
