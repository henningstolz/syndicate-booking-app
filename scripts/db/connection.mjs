// Shared by the test-database scripts: finds TEST_DATABASE_URL, refuses the
// live project, and connects.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Project references (the part of the project's address before .supabase.co)
// that must never be touched by these scripts.
export const LIVE_PROJECTS = ["trdtqhkbxssujcwmvham"];

export const root = fileURLToPath(new URL("../..", import.meta.url));

// Minimal .env.local reader (the scripts run outside Next.js).
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

export async function connectToTestDatabase() {
  const url = process.env.TEST_DATABASE_URL ?? envFromFile().TEST_DATABASE_URL;
  if (!url) {
    console.error("TEST_DATABASE_URL is not set. Add it to .env.local (see docs/systems-and-accounts.md, \"The test database\").");
    process.exit(1);
  }
  if (LIVE_PROJECTS.some((ref) => url.includes(ref))) {
    console.error("Refusing: that connection string points at the LIVE project. These scripts are for the test project only.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}
