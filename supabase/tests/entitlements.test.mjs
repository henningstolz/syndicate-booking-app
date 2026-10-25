// Entitlement inputs test (migration 0026): who may read a group's plan inputs, and that only
// the five fields the check needs come back. Run with: npm run test:db
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
await db.exec(`update public.group_plans set plan = 'standard', billing_status = 'trial', trial_ends_at = '2026-12-31T00:00:00Z',
  paid_until = '2027-01-31', price_locked_until = '2027-06-30', discount_percent = 25, billing_reference = 'INV-9',
  stripe_customer_id = 'cus_secret', stripe_subscription_id = 'sub_secret' where group_id = '${G1}'`);

const inputs = (user, group = G1) => rpc(user, "get_group_entitlement_inputs", group);

const admin = await inputs("alice");
check("a group admin gets the inputs", result(admin), "ok");
const member = await inputs("bob");
check("a plain member gets them too", result(member), "ok");
check("the plan fields are the five the check needs", Object.keys(member.plan).sort(), ["billing_status", "paid_until", "plan", "price_locked_until", "trial_ends_at"]);
check("...with the group's values", [member.plan.plan, member.plan.billing_status, member.plan.trial_ends_at.slice(0, 10), member.plan.paid_until, member.plan.price_locked_until], ["standard", "trial", "2026-12-31", "2027-01-31", "2027-06-30"]);
check("no discount, billing reference or provider id leaves the database", ["discount", "INV-9", "cus_secret", "sub_secret", "25"].some((s) => JSON.stringify(member).includes(s)), false);
check("the platform settings come with it", Object.fromEntries(Object.entries(member.settings).sort()), { billing_enforcement_enabled: false, default_cohort_new_groups: "founding-2026", default_plan_new_groups: "founding", grace_period_days: 14, paid_beta_cutoff: null });
check("a member of another group cannot ask about this group", result(await inputs("eve")), "not_allowed");
check("a signed-in outsider cannot", result(await inputs("zed")), "not_allowed");
check("each group's admin gets their own group's plan, not the other's", [(await inputs("eve", G2)).plan.plan, (await inputs("eve", G2)).plan.billing_status], ["founding", "none"]);
check("anonymous cannot call it", (await rpc(null, "get_group_entitlement_inputs", G1)).thrown?.includes("permission denied") ?? false, true);
check("an unknown group gives not_allowed, not an error", result(await inputs("alice", "99999999-9999-9999-9999-999999999999")), "not_allowed");

await db.exec("reset role");
await db.query("update public.group_members set removed_at = now() where user_id = $1", [U.bob]);
check("a removed member is refused", result(await inputs("bob")), "not_allowed");
await db.exec("reset role");
await db.query("update public.group_members set removed_at = null where user_id = $1", [U.bob]);

await db.exec("delete from public.group_plans where group_id = '" + G2 + "'");
const none = await inputs("eve", G2);
check("a group with no plan row gives result ok and plan null (the app then allows everything)", [result(none), none.plan], ["ok", null]);

h.finish();
