// The "fresh start" routine for a group that stays (scripts/ops/reset-group.sql, docs/runbook-group-reset.md).
// The RESET block of the real script is run against a throwaway database with a group that has data in every
// table: everything of that group's history and setup must go, the group, its plan and the one chosen admin must
// stay, the airframe hours must be exactly what was entered, another group must not be touched, and the script
// must refuse (changing nothing) when it is set up wrongly. Run with: npm run test:db
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHarness } from "./harness.mjs";

const h = createHarness();
const { db, U, check } = h;

await h.setup();
await h.migrate();
await h.addUsers("alice", "bob", "cara", "dan", "eve");
console.log("all migrations applied");

// ------------------------------------------------------------- the script, as the user would edit it
const script = readFileSync(fileURLToPath(new URL("../../scripts/ops/reset-group.sql", import.meta.url)), "utf8");
const block = script.slice(script.indexOf("-- BEGIN RESET"), script.indexOf("-- END RESET"));
check("the script has a RESET block", block.includes("do $reset$") && block.includes("end\n$reset$;"), true);
const edited = (o = {}) =>
  block
    .replace("'THE-GROUP-SLUG'", `'${o.slug ?? "target"}'`)
    .replace("'YOUR-EMAIL-HERE'", `'${o.email ?? "ALICE@example.test"}'`)
    .replace("c_airframe_total_hours constant numeric := null;", `c_airframe_total_hours constant numeric := ${o.total ?? "5871.44"};`)
    .replace("c_next_check_at_hours constant numeric := null;", `c_next_check_at_hours constant numeric := ${o.next ?? "5900"};`);
const run = async (o) => {
  await db.exec("reset role");
  try { await db.exec(edited(o)); return "ok"; } catch (e) { return String(e.message); }
};

// -------------------------------------------------------------------------------- the data
const T = "11111111-1111-1111-1111-111111111111"; // the group that is reset
const O = "22222222-2222-2222-2222-222222222222"; // another group, must not change
await db.exec(`insert into public.groups (id, slug, name, aircraft_registration, aircraft_type, home_base) values
  ('${T}','target','Target Group','G-TARG','PA-28','EGLK'), ('${O}','other','Other Group','G-OTHR','C172','EGHI');`);
const fill = async (g, admin, member, extra) => {
  await db.query(`insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Admin'), ($1,$3,'member','Member')`, [g, U[admin], U[member]]);
  if (extra) await db.query(`insert into public.group_members (group_id,user_id,role,display_name) values ($1,$2,'admin','Second admin'), ($1,$3,'member','Gone')`, [g, U[extra[0]], U[extra[1]]]);
  await db.query(`update public.group_members set removed_at = now() where group_id = $1 and display_name = 'Gone'`, [g]);
  await db.query(`insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,'2026-12-01 10:00+00','2026-12-01 12:00+00')`, [g, U[member]]);
  await db.query(`insert into public.squawks (group_id, author_id, message) values ($1,$2,'hello')`, [g, U[member]]);
  await db.query(`insert into public.flight_entries (group_id, flight_date, from_place, to_place, flight_category, captain_id, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, created_by)
    values ($1,'2026-11-01','A','B','PV',$2,'x',1,1,1,'2026-11-01T09:00:00Z','2026-11-01T09:10:00Z','2026-11-01T10:20:00Z','2026-11-01T10:30:00Z',$2)`, [g, U[admin]]);
  const doc = (await db.query(`insert into public.documents (group_id, uploaded_by, title, category, file_name, content_type, size_bytes, storage_path) values ($1,$2,'Doc','general','a.pdf','application/pdf',10,$3) returning id`, [g, U[admin], `${g}/a.pdf`])).rows[0].id;
  await db.query(`insert into public.cost_expenses (group_id, paid_by, incurred_on, description, amount_pence, created_by, document_id) values ($1,$2,'2026-11-05','Fuel',5000,$3,$4)`, [g, U[member], U[admin], doc]);
  await db.query(`insert into public.cost_payments (group_id, user_id, month, amount_pence, paid_on, created_by) values ($1,$2,'2026-10-01',4000,'2026-11-02',$3)`, [g, U[member], U[admin]]);
  await db.query(`insert into public.cost_month_closures (group_id, month, snapshot, closed_by) values ($1,'2026-10-01','{}'::jsonb,$2)`, [g, U[admin]]);
  await db.query(`insert into public.cost_rates (group_id, effective_month, monthly_fee_pence, hourly_rate_pence, created_by) values ($1,'2026-01-01',1000,2000,$2)`, [g, U[admin]]);
  await db.query(`insert into public.cost_billing_basis (group_id, effective_month, basis, created_by) values ($1,'2026-01-01','flight',$2)`, [g, U[admin]]);
  await db.query(`insert into public.invites (group_id, role, created_by) values ($1,'member',$2)`, [g, U[admin]]);
  await db.query(`insert into public.calendar_feeds (group_id, user_id, token) values ($1,$2,$3)`, [g, U[member], g.slice(0, 1).repeat(64)]);
  await db.query(`insert into public.feedback (group_id, user_id, category, message) values ($1,$2,'idea','a message')`, [g, U[member]]);
  await db.query(`insert into public.export_log (group_id, user_id) values ($1,$2)`, [g, U[admin]]);
  await db.query(`insert into public.reminder_log (group_id, key) values ($1,'booking:x')`, [g]);
  await db.query(`insert into public.notification_preferences (group_id, user_id, event, enabled) values ($1,$2,'chat_message',false)`, [g, U[member]]);
  await db.query(`insert into public.notification_outbox (group_id, recipient_user_id, recipient_email, event) values ($1,$2,'m@example.test','booking_created')`, [g, U[member]]);
  await db.query(`insert into public.terms_acceptances (user_id, group_id, document, version) values ($1,$2,'terms','v1')`, [U[member], g]);
  // custom equipment, dates and old columns
  await db.query(`update public.aircraft_items set due_date = '2027-01-01', label = label || ' (edited)' where group_id = $1`, [g]);
  await db.query(`insert into public.aircraft_items (group_id, label, due_date) values ($1,'Flares','2027-02-02')`, [g]);
  await db.query(`update public.groups set annual_renewal_due='2027-03-01', insurance_renewal_due='2027-04-01', next_check_due='2027-05-01', life_raft_due='2027-06-01',
    life_vests_due='2027-06-02', fire_extinguisher_due='2027-06-03', airframe_hours_baseline=5000, next_check_at_hours=5100 where id = $1`, [g]);
  await db.query(`select public.recalc_airframe_hours($1)`, [g]);
};
await fill(T, "alice", "bob", ["cara", "dan"]);
await fill(O, "eve", "bob");
await db.query(`update public.group_plans set plan = 'complimentary' where group_id = $1`, [T]);

const tables = (await db.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'group_id' order by 1`)).rows.map((r) => r.table_name);
const counts = async (g) => {
  await db.exec("reset role");
  const out = {};
  for (const t of tables) out[t] = (await db.query(`select count(*)::int n from public."${t}" where group_id = $1`, [g])).rows[0].n;
  return out;
};
const otherBefore = await counts(O);
const row = async (g) => { await db.exec("reset role"); return (await db.query("select * from public.groups where id = $1", [g])).rows[0]; };
const otherRowBefore = await row(O);
const planEventsBefore = (await db.query("select count(*)::int n from public.plan_events where group_id = $1", [T])).rows[0].n;
check("(setup) the group to reset has data in every table that has a group_id", Object.entries(await counts(T)).filter(([, n]) => n === 0).map(([t]) => t), []);

// ------------------------------------------------------------------------ it refuses a wrong set-up
const before = await counts(T);
const refuse = async (what, o, text) => {
  const r = await run(o);
  check(`refused: ${what}`, r.includes(text), true);
  check("...and nothing changed", JSON.stringify(await counts(T)), JSON.stringify(before));
};
await refuse("a group that does not exist", { slug: "nope" }, "No group with the address name");
await refuse("an email that is no account", { email: "nobody@example.test" }, "No account with the email");
await refuse("someone who is not an admin of the group", { email: "bob@example.test" }, "not a current admin");
await refuse("an admin of another group", { email: "eve@example.test" }, "not a current admin");
await refuse("a removed member", { email: "dan@example.test" }, "not a current admin");
await refuse("missing airframe hours", { total: "null" }, "Enter the airframe total hours");
await refuse("a silly airframe figure", { total: "-5" }, "Enter the airframe total hours");
await refuse("a silly check figure", { next: "123456" }, "not a sensible number");
check("the script as downloaded (no hours entered yet) does nothing", [(await run({ slug: "THE-GROUP-SLUG", email: "YOUR-EMAIL-HERE", total: "null" })).includes("Enter the airframe total hours"), JSON.stringify(await counts(T)) === JSON.stringify(before)], [true, true]);

// ------------------------------------------------------------------------------------- the reset
check("the reset runs (the email is matched without regard to capitals)", await run(), "ok");

const after = await counts(T);
const keepers = { group_members: 1, aircraft_items: 4, group_plans: 1, terms_acceptances: 1, plan_events: planEventsBefore };
check("every table of the group is empty except the few that stay", Object.entries(after).filter(([t, n]) => n !== (keepers[t] ?? 0)), []);
check("the one member who stays is the chosen admin", (await db.query("select user_id, role, removed_at from public.group_members where group_id = $1", [T])).rows, [{ user_id: U.alice, role: "admin", removed_at: null }]);
check("the other members' accounts still exist", (await db.query("select count(*)::int n from auth.users where id = any($1)", [[U.bob, U.cara, U.dan]])).rows[0].n, 3);
check("the equipment list is back to the four starters, in order, without dates",
  (await db.query("select label, due_date, position from public.aircraft_items where group_id = $1 order by position", [T])).rows,
  [{ label: "Life raft", due_date: null, position: 1 }, { label: "Life vests", due_date: null, position: 2 }, { label: "Fire extinguisher", due_date: null, position: 3 }, { label: "First aid kit", due_date: null, position: 4 }]);

const g = await row(T);
check("the group itself is kept", [g.slug, g.name, g.aircraft_registration, g.aircraft_type, g.home_base], ["target", "Target Group", "G-TARG", "PA-28", "EGLK"]);
check("the dates are cleared", [g.annual_renewal_due, g.insurance_renewal_due, g.next_check_due, g.life_raft_due, g.life_vests_due, g.fire_extinguisher_due, g.hours_to_next_check === null || Number(g.hours_to_next_check) === 28.6], [null, null, null, null, null, null, true]);
check("the airframe hours are exactly the figures entered (rounded to a tenth)", [Number(g.airframe_total_hours), Number(g.airframe_hours_baseline), Number(g.next_check_at_hours), Number(g.hours_to_next_check)], [5871.4, 5871.4, 5900, 28.6]);
check("the plan and its history are untouched", [(await db.query("select plan from public.group_plans where group_id = $1", [T])).rows[0].plan, (await db.query("select count(*)::int n from public.plan_events where group_id = $1", [T])).rows[0].n], ["complimentary", planEventsBefore]);
check("a person's own acceptance of the terms stays", (await db.query("select count(*)::int n from public.terms_acceptances where user_id = $1", [U.bob])).rows[0].n >= 1, true);

// ------------------------------------------------------------------------ the other group
check("another group has exactly the same rows as before", JSON.stringify(await counts(O)), JSON.stringify(otherBefore));
check("...and its group row is unchanged", JSON.stringify(await row(O)), JSON.stringify(otherRowBefore));

// ------------------------------------------------------------------ the group works afterwards
await db.exec("reset role");
check("a new booking and flight can be added after the reset", await (async () => {
  try {
    await db.query(`insert into public.bookings (group_id, member_id, starts_at, ends_at) values ($1,$2,'2027-01-10 10:00+00','2027-01-10 12:00+00')`, [T, U.alice]);
    await db.query(`insert into public.flight_entries (group_id, flight_date, from_place, to_place, flight_category, captain_id, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, created_by)
      values ($1,'2027-01-10','A','B','PV',$2,'x',1,1,1,'2027-01-10T09:00:00Z','2027-01-10T09:10:00Z','2027-01-10T10:20:00Z','2027-01-10T10:30:00Z',$2)`, [T, U.alice]);
    await db.query("select public.recalc_airframe_hours($1)", [T]);
    return Math.round(Number((await db.query("select airframe_total_hours t from public.groups where id = $1", [T])).rows[0].t) * 10) / 10;
  } catch (e) { return e.message; }
})(), 5872.6);

// -------------------------------------- the look and check queries of the script run, and say the right thing
await db.exec("reset role");
const readOnly = script.replace(block, "").replace(/THE-GROUP-SLUG/g, "target");
const results = await db.exec(readOnly);
const last = results[results.length - 1].rows[0];
check("the script's closing check shows one member, four undated items, the two rows the test added afterwards, their hours on top of the new figure, and the plan",
  [Number(last.members), Number(last.equipment_items), Number(last.equipment_with_dates), Number(last.history_rows), Number(last.airframe_total_hours), Number(last.next_check_at_hours), last.plan],
  [1, 4, 0, 2, 5872.6, 5900, "complimentary"]);
check("the script's other queries ran too (look at the group, the people, the counts, the files)", results.length >= 5, true);

h.finish();
