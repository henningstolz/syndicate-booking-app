// Applies the numbered SQL files in supabase/migrations to a TEST database, in
// order, once each, remembering which are done. It exists so the separate test
// project can be built (and kept in step) with one command:
//
//   npm run db:migrate
//
// It reads the test project's connection string from TEST_DATABASE_URL in
// .env.local (Supabase dashboard, Connect, "Session pooler"). It will NOT run
// against the live project: it is refused (see connection.mjs).
import { readFileSync, readdirSync } from "node:fs";
import { connectToTestDatabase, root } from "./connection.mjs";

const dir = `${root}supabase/migrations`;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = await connectToTestDatabase();
try {
  // A table to remember what has been applied (in its own schema, not the app's).
  await client.query("create schema if not exists test_tooling");
  await client.query("create table if not exists test_tooling.applied_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from test_tooling.applied_migrations")).rows.map((r) => r.name));

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    process.stdout.write(`applying ${file} ... `);
    try {
      await client.query("begin");
      await client.query(readFileSync(`${dir}/${file}`, "utf8"));
      await client.query("insert into test_tooling.applied_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("ok");
      applied++;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED");
      console.error(`\n${file}: ${error.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) {
    console.log(applied === 0 ? `Already up to date (${files.length} migrations applied).` : `Done: ${applied} applied, ${files.length} in total.`);
  }
} finally {
  await client.end();
}
