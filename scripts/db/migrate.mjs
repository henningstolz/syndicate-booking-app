// Applies the numbered SQL files in supabase/migrations to a TEST database, in
// order, once each, remembering which are done. It exists so the separate test
// project can be built (and kept in step) with one command:
//
//   npm run db:migrate
//
// It reads the test project's connection string from TEST_DATABASE_URL in
// .env.local (Supabase dashboard, Connect, "Session pooler"). It will NOT run
// against the live project: the live project is listed below and refused.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Project references (the part of the project's address before .supabase.co)
// that must never be touched by this script.
const LIVE_PROJECTS = ["trdtqhkbxssujcwmvham"];

const root = fileURLToPath(new URL("../..", import.meta.url));

// Minimal .env.local reader (the script runs outside Next.js).
function envFromFile() {
  const path = `${root}.env.local`;
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const url = process.env.TEST_DATABASE_URL ?? envFromFile().TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set. Add it to .env.local (see docs/systems-and-accounts.md, \"The test database\").");
  process.exit(1);
}
if (LIVE_PROJECTS.some((ref) => url.includes(ref))) {
  console.error("Refusing: that connection string points at the LIVE project. This script is for the test project only.");
  process.exit(1);
}

const dir = `${root}supabase/migrations`;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
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
