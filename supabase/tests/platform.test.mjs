// Platform foundations test (migration 0025): group plans, the platform admin functions and
// their second-factor check, the append-only history, the default row for new groups, the
// backfill of existing groups, and terms acceptances. Run with: npm run test:db
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, rpc, q, check, result } = h;

await h.setup();
// Everything before 0025 first, with groups already in place: those are the ones the backfill must cover.
await h.migrate({ before: "0025" });
await h.addUsers("alice", "bob", "eve", "root", "zed");

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration) values
  ('${G1}','one','Group One','G-ONE'), ('${G2}','two','Group Two','G-TWO');`);
await db.query(
  `insert into public.group_members (group_id,user_id,role,display_name) values
    ($1,$2,'admin','Alice'), ($1,$3,'member','Bob'), ($4,$5,'admin','Eve')`,
  [G1, U.alice, U.bob, G2, U.eve],
);
await db.exec(`insert into public.bookings (group_id, member_id, starts_at, ends_at, created_at)
  values ('${G1}', '${U.bob}', '2026-12-01 10:00+00', '2026-12-01 12:00+00', '2026-11-20 09:00+00')`);

await h.migrate({ only: "0025" });
console.log("0025 applied over two existing groups");

const sorted = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted(o[k])])) : o);
const blocked = (r) => r.thrown !== undefined || r.length === 0; // refused outright, or no row is visible
const plan = async (g) => { await db.exec("reset role"); return (await db.query("select * from public.group_plans where group_id = $1", [g])).rows; };
const events = async (where = "true") => { await db.exec("reset role"); return (await db.query(`select * from public.plan_events where ${where} order by created_at, id`)).rows; };

// ------------------------------------------------------------------ backfill
{
  const rows = await plan(G1);
  check("backfill: the existing group has one plan row", rows.length, 1);
  check("backfill: founding, founding-2026, status none, nothing else set", [rows[0].plan, rows[0].cohort, rows[0].billing_status, rows[0].trial_ends_at, rows[0].paid_until, rows[0].price_locked_until, rows[0].discount_percent, rows[0].billing_reference], ["founding", "founding-2026", "none", null, null, null, null, null]);
  await db.exec("reset role");
  check("backfill: one plan row per group (the two above and the one the seed migration made)", (await db.query("select (select count(*) from public.groups)::int g, (select count(*) from public.group_plans)::int p")).rows[0], { g: 3, p: 3 });
  check("backfill: one history entry per group, marked as backfill", [(await events("event_type = 'group_created'")).length, (await events("reason = 'backfill'")).length, (await events("group_id in ('" + G1 + "','" + G2 + "')")).map((e) => e.reason)], [3, 3, ["backfill", "backfill"]]);
}

// ------------------------------------------------------ plan rows are private
{
  check("a group admin reads their own plan row", (await q("alice", "select group_id, plan from public.group_plans")).map((r) => r.group_id), [G1]);
  check("...and not another group's", (await q("alice", "select * from public.group_plans where group_id = $1", [G2])).length, 0);
  check("another group's admin sees only their own", (await q("eve", "select group_id from public.group_plans")).map((r) => r.group_id), [G2]);
  check("a plain member sees no plan row", (await q("bob", "select * from public.group_plans")).length, 0);
  check("a signed-in outsider sees none", (await q("zed", "select * from public.group_plans")).length, 0);
  check("anonymous cannot read", (await q(null, "select * from public.group_plans")).thrown?.includes("permission denied") ?? false, true);
  check("a group admin cannot write their plan row, by any statement", [
    blocked(await q("alice", "update public.group_plans set plan = 'complimentary' where group_id = $1 returning group_id", [G1])),
    blocked(await q("alice", "delete from public.group_plans where group_id = $1 returning group_id", [G1])),
    blocked(await q("alice", "insert into public.group_plans (group_id, plan) values ($1, 'founding') returning group_id", [G1])),
  ], [true, true, true]);
  check("...and the row is unchanged", (await plan(G1))[0].plan, "founding");
}

// ------------------------------------- ordinary users reach nothing of the platform
{
  const adminCalls = [
    ["admin_list_groups"],
    ["admin_update_group_plan", G1, { plan: "complimentary" }, "because"],
    ["admin_update_setting", "grace_period_days", 30, "because"],
    ["admin_list_plan_events", G1, 10],
  ];
  for (const user of ["alice", "bob", "zed"]) {
    const got = [];
    for (const [fn, ...args] of adminCalls) {
      const r = await rpc(user, fn, ...args.map((a) => (a && typeof a === "object" ? JSON.stringify(a) : a)));
      got.push(result(r));
    }
    check(`${user}: every admin function says not_allowed`, got, ["not_allowed", "not_allowed", "not_allowed", "not_allowed"]);
  }
  check("anonymous cannot call an admin function", (await rpc(null, "admin_list_groups")).thrown?.includes("permission denied") ?? false, true);
  check("nobody reads the admin tables directly", [
    blocked(await q("alice", "select * from public.platform_admins")),
    blocked(await q("alice", "select * from public.plan_events")),
    blocked(await q("alice", "select * from public.platform_settings")),
    blocked(await q("bob", "select * from public.platform_admins")),
  ], [true, true, true, true]);
  check("nobody can make themselves a platform admin", [
    blocked(await q("alice", "insert into public.platform_admins (user_id) values ($1) returning user_id", [U.alice])),
    blocked(await q("alice", "insert into public.platform_settings (key, value) values ('grace_period_days', '1') on conflict (key) do update set value = '1' returning key")),
    blocked(await q("alice", "update public.platform_settings set value = 'true' returning key")),
  ], [true, true, true]);
  check("is_platform_admin is false for ordinary people", [await rpc("alice", "is_platform_admin"), await rpc("alice@aal2", "is_platform_admin")], [false, false]);
}

// -------------------------------------------------- the platform admin, and MFA
await db.exec("reset role");
await db.query("insert into public.platform_admins (user_id) values ($1)", [U.root]);
{
  check("is_platform_admin is true for the admin (with or without a second factor)", [await rpc("root", "is_platform_admin"), await rpc("root@aal2", "is_platform_admin")], [true, true]);
  check("platform_admin_ok needs the second factor", [await rpc("root", "platform_admin_ok"), await rpc("root@aal1", "platform_admin_ok"), await rpc("root@aal2", "platform_admin_ok")], [false, false, true]);
  for (const user of ["root", "root@aal1"]) {
    const got = [];
    for (const [fn, ...args] of [["admin_list_groups"], ["admin_update_group_plan", G1, JSON.stringify({ plan: "complimentary" }), "because"], ["admin_update_setting", "grace_period_days", "30", "because"], ["admin_list_plan_events", G1, 10]]) {
      got.push(result(await rpc(user, fn, ...args)));
    }
    check(`${user}: without the second factor every admin function says not_allowed`, got, ["not_allowed", "not_allowed", "not_allowed", "not_allowed"]);
  }
  check("...and nothing changed", [(await plan(G1))[0].plan, (await events("event_type = 'plan_changed'")).length], ["founding", 0]);
  check("the admin without the second factor cannot read the admin tables either", [
    blocked(await q("root", "select * from public.plan_events")), blocked(await q("root@aal2", "select * from public.plan_events")),
  ], [true, true]);
  check("an admin is not a member: they cannot read a group's plan row directly", (await q("root@aal2", "select * from public.group_plans")).length, 0);
}

// ------------------------------------------------------------- admin_list_groups
{
  const r = await rpc("root@aal2", "admin_list_groups");
  check("the admin lists every group", [result(r), r.groups.length], ["ok", 3]);
  const one = r.groups.find((g) => g.group_id === G1);
  check("a group row has the metadata the page needs", [one.name, one.slug, one.aircraft_count, one.member_count, one.plan, one.billing_status, one.cohort], ["Group One", "one", 1, 2, "founding", "none", "founding-2026"]);
  check("the group admins are named with their email, the plain member is not", one.admins, [{ name: "Alice", email: "alice@example.test" }]);
  check("last activity is the latest booking or flight entry", one.last_activity?.startsWith("2026-11-20"), true);
  check("a group with no activity has none", r.groups.find((g) => g.group_id === G2).last_activity, null);
  const keys = Object.keys(one);
  check("nothing from bookings, the flight log or costs, and no member emails beyond the admins", [keys.some((k) => /booking|flight|cost|squawk|chat|note|member_email/.test(k)), JSON.stringify(r).includes("bob@example.test")], [false, false]);
  await db.exec("reset role");
  await db.query("update public.group_members set removed_at = now() where user_id = $1", [U.bob]);
  const after = await rpc("root@aal2", "admin_list_groups");
  check("a removed member is not counted", after.groups.find((g) => g.group_id === G1).member_count, 1);
  await db.exec("reset role");
  await db.query("update public.group_members set removed_at = null where user_id = $1", [U.bob]);
}

// -------------------------------------------------------- admin_update_group_plan
{
  const upd = (changes, reason = "agreed by email", g = G1, user = "root@aal2") => rpc(user, "admin_update_group_plan", g, JSON.stringify(changes), reason);
  check("a reason is required", [result(await upd({ plan: "standard" }, "")), result(await upd({ plan: "standard" }, "  ")), result(await upd({ plan: "standard" }, "ab")), result(await upd({ plan: "standard" }, null))], ["reason_required", "reason_required", "reason_required", "reason_required"]);
  check("a reason cannot be a novel", result(await upd({ plan: "standard" }, "x".repeat(501))), "reason_too_long");
  check("changes must be a non-empty object", [result(await upd({})), result(await upd([1])), result(await rpc("root@aal2", "admin_update_group_plan", G1, "5", "because"))], ["changes_invalid", "changes_invalid", "changes_invalid"]);
  check("an unknown field is refused", sorted(await upd({ group_id: G2 })), { field: "group_id", result: "field_unknown" });
  check("the group id and the dates of creation cannot be changed through it", [result(await upd({ created_at: "2020-01-01" })), result(await upd({ updated_by: U.root }))], ["field_unknown", "field_unknown"]);
  check("nested values are refused", result(await upd({ cohort: { a: 1 } })), "invalid");
  check("an unknown plan, status or a discount out of range is refused", [result(await upd({ plan: "platinum" })), result(await upd({ billing_status: "paid" })), result(await upd({ discount_percent: 101 })), result(await upd({ discount_percent: -1 })), result(await upd({ discount_percent: 12.5 })), result(await upd({ plan: null }))], ["invalid", "invalid", "invalid", "invalid", "invalid", "invalid"]);
  check("a bad date or text length is refused", [result(await upd({ paid_until: "next week" })), result(await upd({ trial_ends_at: "tomorrow" })), result(await upd({ paid_until: "2026-02-30" })), result(await upd({ discount_percent: "20" })), result(await upd({ billing_reference: 5 })), result(await upd({ billing_reference: "x".repeat(201) })), result(await upd({ cohort: "" }))], Array(7).fill("invalid"));
  check("an unknown group is not found", result(await upd({ plan: "standard" }, "because", "99999999-9999-9999-9999-999999999999")), "not_found");
  check("after all that, nothing changed and nothing was logged", [(await plan(G1))[0].plan, (await events("event_type = 'plan_changed'")).length], ["founding", 0]);

  const ok = await upd({ plan: "standard", billing_status: "trial", trial_ends_at: "2026-12-31T00:00:00Z", paid_until: "2027-01-31", discount_percent: 20, billing_reference: "INV-001" }, "  trial agreed with the group  ");
  check("a valid change is accepted and lists what changed", [ok.result, ok.changed.sort()], ["ok", ["billing_reference", "billing_status", "discount_percent", "paid_until", "plan", "trial_ends_at"]]);
  const row = (await plan(G1))[0];
  check("the row has the new values and who/when", [row.plan, row.billing_status, row.paid_until instanceof Date ? row.paid_until.toISOString().slice(0, 10) : String(row.paid_until).slice(0, 10), row.discount_percent, row.billing_reference, row.updated_by, row.cohort], ["standard", "trial", "2027-01-31", 20, "INV-001", U.root, "founding-2026"]);
  const ev = (await events("event_type = 'plan_changed'"))[0];
  check("one history entry with old and new values for the changed fields only, the reason trimmed, and who did it", [ev.group_id, ev.actor_id, ev.reason, sorted(ev.old_values), Object.keys(ev.new_values).sort(), ev.new_values.plan, ev.new_values.discount_percent], [G1, U.root, "trial agreed with the group", sorted({ plan: "founding", billing_status: "none", trial_ends_at: null, paid_until: null, discount_percent: null, billing_reference: null }), ["billing_reference", "billing_status", "discount_percent", "paid_until", "plan", "trial_ends_at"], "standard", 20]);
  check("saving the same values again is reported and not logged", [result(await upd({ plan: "standard", discount_percent: 20 })), (await events("event_type = 'plan_changed'")).length], ["no_change", 1]);
  check("a field can be cleared with null", [result(await upd({ discount_percent: null, billing_reference: null })), (await plan(G1))[0].discount_percent], ["ok", null]);
  check("the other group is untouched", (await plan(G2))[0].plan, "founding");
  check("complimentary is a valid plan", result(await upd({ plan: "complimentary", billing_status: "none" }, "our own group")), "ok");
}

// ------------------------------------------------------------ admin_update_setting
{
  const set = (key, value, reason = "testing") => rpc("root@aal2", "admin_update_setting", key, value === undefined ? null : JSON.stringify(value), reason);
  const settings = async () => (await rpc("alice", "get_platform_settings")).settings;
  check("any signed-in person can read the settings; anonymous cannot", [(await settings()).grace_period_days, (await rpc(null, "get_platform_settings")).thrown?.includes("permission denied") ?? false], [14, true]);
  check("the starting settings", sorted(await settings()), sorted({ billing_enforcement_enabled: false, default_plan_new_groups: "founding", default_cohort_new_groups: "founding-2026", paid_beta_cutoff: null, grace_period_days: 14 }));
  check("a reason is required and the key must be known", [result(await set("grace_period_days", 30, "")), result(await set("nonsense", 1))], ["reason_required", "field_unknown"]);
  check("each setting accepts only its own kind of value", [
    result(await set("billing_enforcement_enabled", "yes")), result(await set("billing_enforcement_enabled", 1)),
    result(await set("default_plan_new_groups", "gold")), result(await set("default_plan_new_groups", null)),
    result(await set("default_cohort_new_groups", "")), result(await set("default_cohort_new_groups", "x".repeat(41))),
    result(await set("paid_beta_cutoff", "soon")), result(await set("paid_beta_cutoff", "2026-13-45")), result(await set("paid_beta_cutoff", 20261201)),
    result(await set("grace_period_days", -1)), result(await set("grace_period_days", 366)), result(await set("grace_period_days", 1.5)), result(await set("grace_period_days", "14")),
  ], Array(13).fill("invalid"));
  check("...and nothing changed or was logged", [(await settings()).grace_period_days, (await events("event_type = 'setting_changed'")).length], [14, 0]);
  check("valid values are accepted", [result(await set("grace_period_days", 30)), result(await set("billing_enforcement_enabled", true)), result(await set("default_cohort_new_groups", "beta-2027")), result(await set("paid_beta_cutoff", "2027-06-01")), result(await set("paid_beta_cutoff", null))], ["ok", "ok", "ok", "ok", "ok"]);
  check("the settings show it", sorted(await settings()), sorted({ billing_enforcement_enabled: true, default_plan_new_groups: "founding", default_cohort_new_groups: "beta-2027", paid_beta_cutoff: null, grace_period_days: 30 }));
  check("the same value again is not logged", [result(await set("grace_period_days", 30)), (await events("event_type = 'setting_changed' and group_id is null")).length], ["no_change", 5]);
  const ev = (await events("event_type = 'setting_changed'"))[0];
  check("a setting history entry has the key, old and new value, reason and no group", [ev.group_id, ev.actor_id, ev.old_values, ev.new_values, ev.reason], [null, U.root, { grace_period_days: 14 }, { grace_period_days: 30 }, "testing"]);
  const list = await rpc("root@aal2", "admin_list_plan_events", null, 50);
  check("the history call returns the platform-wide entries, newest first, with who", [result(list), list.events.length, list.events[0].new_values, list.events[0].actor_email], ["ok", 5, { paid_beta_cutoff: null }, "root@example.test"]);
  const gl = await rpc("root@aal2", "admin_list_plan_events", G1, 50);
  check("the history call for a group returns that group's entries only", [gl.events.length, gl.events.every((e) => e.group_id === G1)], [4, true]);
  check("the limit is respected", (await rpc("root@aal2", "admin_list_plan_events", G1, 1)).events.length, 1);
}

// -------------------------------------------------------- history cannot be changed
{
  await db.exec("reset role");
  const refused = async (sql) => { try { await db.exec(sql); return "allowed"; } catch (e) { return e.message.includes("append-only") ? "refused" : e.message; } };
  check("history: update, delete and truncate are refused, even for the table owner", [
    await refused("update public.plan_events set reason = 'edited'"),
    await refused("delete from public.plan_events"),
    await refused("truncate public.plan_events"),
  ], ["refused", "refused", "refused"]);
  check("history: ...and for the admin through the app's role", [
    blocked(await q("root@aal2", "update public.plan_events set reason = 'edited' returning id")),
    blocked(await q("root@aal2", "delete from public.plan_events returning id")),
  ], [true, true]);
  check("history: the entries are all still there, unedited", [(await events()).length, (await events("reason = 'edited'")).length], [11, 0]);
}

// -------------------------------------------------------------- new groups
{
  await db.exec("reset role");
  const before = (await events()).length;
  await h.as("eve");
  const G3 = "33333333-3333-3333-3333-333333333333";
  await db.query("insert into public.groups (id, slug, name, aircraft_registration) values ($1, 'three', 'Group Three', 'G-THREE')", [G3]);
  const rows = await plan(G3);
  check("a new group gets exactly one plan row, following the settings (beta-2027 was set above)", [rows.length, rows[0].plan, rows[0].cohort, rows[0].billing_status], [1, "founding", "beta-2027", "none"]);
  const ev = (await events("group_id = '" + G3 + "'"));
  check("...and one history entry, with the person who created it", [ev.length, ev[0].event_type, ev[0].actor_id, ev[0].reason], [1, "group_created", U.eve, "group created"]);
  check("...and the person creating the group could not have done that themselves", blocked(await q("eve", "insert into public.group_plans (group_id, plan) values ($1, 'complimentary') returning group_id", [G3])), true);

  // After the cut-off date, new groups are standard groups.
  await rpc("root@aal2", "admin_update_setting", "paid_beta_cutoff", JSON.stringify("2020-01-01"), "cut-off in the past");
  await h.as("eve");
  const G4 = "44444444-4444-4444-4444-444444444444";
  await db.query("insert into public.groups (id, slug, name, aircraft_registration) values ($1, 'four', 'Group Four', 'G-FOUR')", [G4]);
  check("after the cut-off date a new group is standard, with no cohort", (await plan(G4)).map((r) => [r.plan, r.cohort]), [["standard", null]]);
  await rpc("root@aal2", "admin_update_setting", "paid_beta_cutoff", null, "cut-off cleared");

  // Missing or odd settings never stop a group from being created.
  await db.exec("reset role");
  await db.exec("delete from public.platform_settings");
  await db.exec("insert into public.groups (id, slug, name, aircraft_registration) values ('55555555-5555-5555-5555-555555555555', 'five', 'Group Five', 'G-FIVE')");
  check("with no settings at all a new group is still created, as founding", (await plan("55555555-5555-5555-5555-555555555555")).map((r) => [r.plan, r.cohort]), [["founding", "founding-2026"]]);
  await db.exec(`insert into public.platform_settings (key, value) values ('default_plan_new_groups', '"gold"'), ('default_cohort_new_groups', '""'), ('paid_beta_cutoff', '"junk"')`);
  await db.exec("insert into public.groups (id, slug, name, aircraft_registration) values ('66666666-6666-6666-6666-666666666666', 'six', 'Group Six', 'G-SIX')");
  check("with odd settings it also falls back to founding", (await plan("66666666-6666-6666-6666-666666666666")).map((r) => [r.plan, r.cohort]), [["founding", "founding-2026"]]);

  // A group can still be deleted; its plan row goes and its history stays.
  await db.exec("delete from public.groups where id = '66666666-6666-6666-6666-666666666666'");
  check("deleting a group removes its plan row and keeps its history", [(await plan("66666666-6666-6666-6666-666666666666")).length, (await events("group_id = '66666666-6666-6666-6666-666666666666'")).length], [0, 1]);
  check("every group has exactly one plan row", (await db.query("select (select count(*) from public.groups)::int g, (select count(*) from public.group_plans)::int p")).rows[0].g, (await db.query("select count(*)::int c from public.group_plans")).rows[0].c);
  void before;
}

// ----------------------------------------------------------- terms acceptances
{
  const accept = (user, doc, version, group = null) => q(user, "insert into public.terms_acceptances (user_id, group_id, document, version) values ($1, $2, $3, $4) returning id", [U[user.split("@")[0]], group, doc, version]);
  check("a person records their own acceptance", [blocked(await accept("bob", "terms", "2026-11")), blocked(await accept("bob", "privacy", "2026-11", G1))], [false, false]);
  check("...a second time for the same version leaves one row", [blocked(await accept("bob", "terms", "2026-11")), (await q("bob", "select * from public.terms_acceptances where document = 'terms'")).length], [true, 1]);
  check("a new version is a new row", [blocked(await accept("bob", "terms", "2027-01")), (await q("bob", "select * from public.terms_acceptances")).length], [false, 3]);
  check("nobody records one for someone else", blocked(await q("bob", "insert into public.terms_acceptances (user_id, document, version) values ($1, 'terms', 'x') returning id", [U.alice])), true);
  check("...or for a group they are not in", blocked(await accept("bob", "terms", "2026-11", G2)), true);
  check("...or for an unknown document or an empty version", [blocked(await accept("bob", "cookies", "1")), blocked(await accept("bob", "terms", ""))], [true, true]);
  check("people see only their own acceptances", [(await q("alice", "select * from public.terms_acceptances")).length, (await q("zed", "select * from public.terms_acceptances")).length], [0, 0]);
  check("acceptances cannot be edited or removed from the app", [blocked(await q("bob", "update public.terms_acceptances set version = 'x' returning id")), blocked(await q("bob", "delete from public.terms_acceptances returning id"))], [true, true]);
  check("no address or device is stored", (await q("bob", "select column_name from information_schema.columns where table_name = 'terms_acceptances' order by 1")).map((r) => r.column_name), ["accepted_at", "document", "group_id", "id", "user_id", "version"]);
}

h.finish();
