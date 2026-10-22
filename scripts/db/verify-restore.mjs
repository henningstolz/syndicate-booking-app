// Looks at a restored database and says whether it is really usable, not only
// that the rows came back. Read only. Works on the TEST project only (it uses the
// same guard as the other db scripts).
//
//   node scripts/db/verify-restore.mjs            what is in it, with dates and group routes
//   node scripts/db/verify-restore.mjs --public   only yes/no answers and no data, safe for public logs
//   add --skip-files when only the database was restored (the drill workflow does this)
//
// The restore drill runs it with --public (this repository's logs are public). On your
// own Mac run it without the flag after a drill, then open the routes it prints in a
// local `npm run dev` with TEST_ values and look at them.
import { connectToTestDatabase } from "./connection.mjs";

const isPublic = process.argv.includes("--public");
const skipFiles = process.argv.includes("--skip-files");
const db = await connectToTestDatabase();
const one = async (sql) => (await db.query(sql)).rows[0];
let problems = 0;
const line = (ok, text) => {
  if (!ok) problems++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
};

try {
  // Every table in the app's schema, how many rows, and whether the security rules are on.
  const tables = (await db.query(`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by c.relname`)).rows;
  line(tables.length > 0, isPublic ? "the app's tables are there" : `${tables.length} tables in the app's schema`);
  const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
  line(noRls.length === 0, isPublic ? "security rules are on for every table" : `security rules on for every table${noRls.length ? ` (OFF for: ${noRls.join(", ")})` : ""}`);

  const counts = {};
  for (const t of tables) counts[t.name] = Number((await one(`select count(*) as n from public."${t.name}"`)).n);
  if (!isPublic) for (const t of tables) console.log(`     ${t.name.padEnd(28)} ${counts[t.name]}`);

  const people = Number((await one(`select count(*) as n from auth.users`)).n);
  line(people > 0, isPublic ? "people who can sign in are there" : `${people} people can sign in`);

  // The newest of each kind of record: proves the data is not just present but recent.
  const newest = [
    ["booking", `select starts_at::date as d, (select slug from public.groups g where g.id = b.group_id) as slug from public.bookings b order by starts_at desc limit 1`, "calendar"],
    ["flight log entry", `select flight_date as d, (select slug from public.groups g where g.id = f.group_id) as slug from public.flight_entries f order by flight_date desc limit 1`, "tech-log"],
    ["closed month", `select month as d, (select slug from public.groups g where g.id = c.group_id) as slug from public.cost_month_closures c where reopened_at is null order by month desc limit 1`, "costs"],
  ];
  for (const [what, sql, page] of newest) {
    const row = await one(sql);
    if (isPublic) line(Boolean(row), `a ${what} is there`);
    else line(Boolean(row), row ? `newest ${what}: ${new Date(row.d).toISOString().slice(0, 10)}  /${row.slug}/${page}` : `no ${what} found`);
  }

  // The stored files are not part of the database restore: the rows say a file exists,
  // the file store has to be filled separately (docs/runbook-restore.md).
  const docs = Number((await one(`select count(*) as n from public.documents`)).n);
  const files = Number((await one(`select count(*) as n from storage.objects where bucket_id = 'documents'`)).n);
  if (skipFiles) console.log("skip stored files (the database restore does not copy them)");
  else line(docs === files, isPublic ? `documents in the database match the stored files: ${docs === files ? "yes" : "no"}` : `documents ${docs}, stored files ${files}${docs === files ? "" : " (not equal: files still to be copied across)"}`);
} finally {
  await db.end();
}
if (problems) {
  console.log(`\n${problems} thing${problems === 1 ? "" : "s"} to look at.`);
  process.exit(1);
}
console.log("\nThe restored database looks usable.");
