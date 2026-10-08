// Calendar subscription database test: the private link per member, who can see
// it, what the feed returns (and what it must not), and everything that turns it
// off. Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve");
console.log("all migrations applied");

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values
    ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($1,$4,'member','Cara'),
    ($5,$6,'admin','Eve')`,
  [G1, U.alice, U.bob, U.cara, G2, U.eve],
);
const booking = async (group, who, startsAt, endsAt, o = {}) =>
  (await db.query("insert into public.bookings (group_id, member_id, starts_at, ends_at, note, status) values ($1,$2,$3,$4,$5,$6) returning id", [group, U[who], startsAt, endsAt, o.note ?? null, o.status ?? "confirmed"])).rows[0].id;

const day = (n) => new Date(Date.now() + n * 86400000);
const at = (n, hour) => { const d = day(n); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
await db.exec("reset role");
const b1 = await booking(G1, "alice", at(2, 9), at(2, 11), { note: "Fly-out lunch" });
const b2 = await booking(G1, "bob", at(3, 9), at(3, 12));
const cancelled = await booking(G1, "bob", at(4, 9), at(4, 10), { status: "cancelled" });
const old = await booking(G1, "cara", at(-90, 9), at(-90, 10));
const recent = await booking(G1, "cara", at(-10, 9), at(-10, 10));
const other = await booking(G2, "eve", at(2, 9), at(2, 10), { note: "Secret of group two" });

const tokenOf = async (user, group) => (await q(user, "select token from public.calendar_feeds where group_id = $1 and revoked_at is null", [group]))[0]?.token;
const feed = async (token) => (await rpc(null, "calendar_feed", token));

// ---------------------------------------------------------- creating a link
check("an outsider cannot create a link for a group", result(await rpc("eve", "create_calendar_feed", G1)), "not_allowed");
check("anonymous cannot create one", (await rpc(null, "create_calendar_feed", G1)).thrown?.includes("permission denied") ?? false, true);
check("a member creates theirs", result(await rpc("bob", "create_calendar_feed", G1)), "ok");
const bobToken = await tokenOf("bob", G1);
check("the link is 64 hex characters", /^[0-9a-f]{64}$/.test(bobToken), true);
check("another member sees nothing of it (not even an admin)", [await tokenOf("alice", G1), await tokenOf("cara", G1), (await q("alice", "select count(*)::int n from public.calendar_feeds"))[0].n], [undefined, undefined, 0]);
check("nobody writes the table directly", [(await q("bob", "update public.calendar_feeds set revoked_at = null returning id")).length, (await q("bob", "delete from public.calendar_feeds returning id")).length, (await q("bob", "insert into public.calendar_feeds (group_id, user_id, token) values ($1,$2,$3)", [G1, U.bob, "a".repeat(64)])).thrown?.includes("row-level security") ?? false], [0, 0, true]);

// ---------------------------------------------------------------- the feed
let f = await feed(bobToken);
check("the feed names the group and aircraft", [f.group_name, f.group_slug, f.registration], ["Group One", "one", "G-ONE"]);
check("it lists the group's confirmed bookings, oldest first, from 60 days back", f.bookings.map((b) => b.id), [recent, b1, b2]);
check("...not cancelled ones, not very old ones, and not another group's", [f.bookings.some((b) => b.id === cancelled), f.bookings.some((b) => b.id === old), f.bookings.some((b) => b.id === other), JSON.stringify(f).includes("Secret of group two")], [false, false, false, false]);
check("each booking says who, and marks the member's own", f.bookings.map((b) => [b.who, b.mine]), [["Cara", false], ["Alice", false], ["Bob", true]]);
check("notes come with it", f.bookings.find((b) => b.id === b1).note, "Fly-out lunch");
check("the feed holds no ids or addresses of members", [JSON.stringify(f).includes(U.alice), JSON.stringify(f).includes("@")], [false, false]);

// ----------------------------------------------------------- what it refuses
check("a wrong token gets nothing", [await feed("0".repeat(64)), await feed("short"), await feed(null), await feed("")], [null, null, null, null]);
check("the table of links cannot be listed by anonymous visitors", (await q(null, "select * from public.calendar_feeds")).length ?? (await q(null, "select * from public.calendar_feeds")).thrown !== undefined, true);

// ---------------------------------------------------------- replacing a link
check("a new link replaces the old one", result(await rpc("bob", "create_calendar_feed", G1)), "ok");
const bobToken2 = await tokenOf("bob", G1);
check("...it is different", bobToken2 !== bobToken, true);
check("...and the old link stops at once", [await feed(bobToken), (await feed(bobToken2)).bookings.length], [null, 3]);
await db.exec("reset role");
check("only one link per member and group is active", (await db.query("select count(*)::int n from public.calendar_feeds where user_id = $1 and revoked_at is null", [U.bob])).rows[0].n, 1);

// ------------------------------------------------------------ turning it off
check("a member without a link gets 'no_feed'", result(await rpc("cara", "revoke_calendar_feed", G1)), "no_feed");
check("an outsider cannot turn off someone's link", result(await rpc("eve", "revoke_calendar_feed", G1)), "not_allowed");
check("a member turns theirs off", result(await rpc("bob", "revoke_calendar_feed", G1)), "ok");
check("...and it stops", await feed(bobToken2), null);

// ----------------------------------------------- links belong to member and group
await rpc("alice", "create_calendar_feed", G1);
await rpc("eve", "create_calendar_feed", G2);
const aliceToken = await tokenOf("alice", G1);
const eveToken = await tokenOf("eve", G2);
check("each link shows its own group only", [(await feed(aliceToken)).registration, (await feed(eveToken)).registration, (await feed(eveToken)).bookings.map((b) => b.id)], ["G-ONE", "G-TWO", [other]]);
check("and marks its own member's bookings", [(await feed(aliceToken)).bookings.filter((b) => b.mine).map((b) => b.id), (await feed(eveToken)).bookings.map((b) => b.mine)], [[b1], [true]]);

// ------------------------------------------------ leaving the group ends the link
await db.exec("reset role");
await db.query("update public.group_members set removed_at = now() where user_id = $1 and group_id = $2", [U.alice, G1]);
check("a removed member's link stops working", await feed(aliceToken), null);
await db.exec("reset role");
await db.query("update public.group_members set removed_at = null where user_id = $1 and group_id = $2", [U.alice, G1]);
check("...and works again if they are re-added (the link was never revoked)", (await feed(aliceToken)) !== null, true);

// ------------------------------------------------ bookings change, the feed follows
await db.exec("reset role");
await db.query("update public.bookings set status = 'cancelled' where id = $1", [b2]);
check("a cancelled booking drops out of the feed", (await feed(aliceToken)).bookings.map((b) => b.id), [recent, b1]);
await db.exec("reset role");
await db.query("update public.bookings set note = 'New note' where id = $1", [b1]);
check("an edited note shows at the next refresh", (await feed(aliceToken)).bookings.find((b) => b.id === b1).note, "New note");

h.finish();
