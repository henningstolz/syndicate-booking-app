// Empties the TEST project completely (see wipe.sql), so it can be rebuilt with
// `npm run db:migrate`. Use it after a restore drill, which leaves a copy of the
// real data in the test project. Refuses the live project.
//
//   npm run db:reset-test -- --yes
import { readFileSync } from "node:fs";
import { connectToTestDatabase, root } from "./connection.mjs";

if (!process.argv.includes("--yes")) {
  console.error("This deletes EVERYTHING in the test project (all tables, data and test sign-ins).\nRun it again with --yes to confirm:  npm run db:reset-test -- --yes");
  process.exit(1);
}
const client = await connectToTestDatabase();
try {
  await client.query(readFileSync(`${root}scripts/db/wipe.sql`, "utf8"));
  console.log("The test project is empty. Rebuild it with:  npm run db:migrate");
} finally {
  await client.end();
}
