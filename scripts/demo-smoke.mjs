// Visits every page of the demo group on a running server and checks it loads.
// The demo answers the app's database questions from invented data (see
// src/lib/demo); when a page starts asking something the demo cannot answer,
// it fails here. Run after changing any page or query:
//
//   npm run dev            (in one terminal)
//   npm run test:demo      (in another; optional: BASE=https://blocktime.group)
const BASE = process.env.BASE ?? "http://localhost:3000";
const month = new Date().toISOString().slice(0, 7);
const monthsAgo = (n) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n, 1); return d.toISOString().slice(0, 7); };
const lastMonth = monthsAgo(1);

const pages = [
  "/demo",
  "/demo/calendar?view=month",
  "/demo/calendar?view=list",
  "/demo/chat",
  "/demo/tech-log",
  "/demo/reports",
  "/demo/reports?view=mine",
  "/demo/reports?view=distribution",
  "/demo/reports?view=distribution&metric=days&year=all",
  "/demo/aircraft",
  "/demo/members",
  "/demo/settings",
  "/demo/settings?tab=notifications",
  "/demo/costs",
  `/demo/costs?month=${lastMonth}`,
];

let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
};

for (const path of pages) {
  const response = await fetch(BASE + path, { redirect: "manual" });
  const html = await response.text();
  check(response.status === 200, `${path} loads`, `status ${response.status}`);
  check(html.includes("Made-up data"), `${path} shows the demo banner`);
  check(!/Application error|does not exist|The demo does not support/i.test(html), `${path} has no error text`);
}

const pdf = await fetch(`${BASE}/demo/tech-log/pdf?month=${month}`, { redirect: "manual" });
const bytes = new Uint8Array(await pdf.arrayBuffer());
check(
  pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-",
  "the demo's monthly PDF downloads",
  `status ${pdf.status}`,
);

for (const [what, query] of [["a member's statement", `month=${month}`], ["everyone's statements", `month=${month}&member=all`], ["a closed month's statement", `month=${monthsAgo(3)}`]]) {
  const statement = await fetch(`${BASE}/demo/costs/pdf?${query}`, { redirect: "manual" });
  const statementBytes = new Uint8Array(await statement.arrayBuffer());
  check(
    statement.status === 200 && statement.headers.get("content-type") === "application/pdf" && String.fromCharCode(...statementBytes.slice(0, 5)) === "%PDF-",
    `the demo's cost statement PDF downloads (${what})`,
    `status ${statement.status}`,
  );
}

// The demo is switched on by the web address alone. A visitor who sends the
// demo header to a REAL group's address must still get the real app (here:
// sent to the sign-in page), never demo data.
const spoof = await fetch(`${BASE}/g-bbfd`, { redirect: "manual", headers: { "x-blocktime-demo": "1" } });
check(spoof.status === 307 && (spoof.headers.get("location") ?? "").includes("/login"), "a spoofed demo header on a real group does nothing", `status ${spoof.status} -> ${spoof.headers.get("location")}`);

const reset = await fetch(`${BASE}/demo/reset`, { redirect: "manual" });
check(reset.status === 307 && (reset.headers.get("location") ?? "").endsWith("/demo"), "Reset demo redirects back to the demo");

console.log(failed ? `\n${failed} failed` : "\nall demo pages fine");
process.exit(failed ? 1 : 0);
