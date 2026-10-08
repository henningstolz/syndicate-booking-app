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
  "/demo/settings?tab=calendar",
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

// The installable app: its manifest, its icons, and where it opens.
{
  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  const json = await manifest.json().catch(() => null);
  check(
    manifest.status === 200 && json?.display === "standalone" && json?.start_url === "/open" && json?.icons?.some((i) => i.sizes === "192x192") && json?.icons?.some((i) => i.sizes === "512x512" && i.purpose === "maskable"),
    "the web app manifest is served with its icons",
    `status ${manifest.status}`,
  );
  for (const path of ["/pwa-icon/192.png", "/pwa-icon/512.png", "/apple-icon", "/icon"]) {
    const icon = await fetch(`${BASE}${path}`);
    const head = new Uint8Array(await icon.arrayBuffer()).slice(0, 4);
    check(icon.status === 200 && icon.headers.get("content-type") === "image/png" && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47, `${path} is a PNG`, `status ${icon.status}`);
  }
  check((await fetch(`${BASE}/pwa-icon/999.png`)).status === 404, "an unknown icon size is a 404");
  const open = await fetch(`${BASE}/open`, { redirect: "manual" });
  check(open.status === 307 && (open.headers.get("location") ?? "").endsWith("/login"), "the installed app's start page sends someone who is not signed in to sign-in", `status ${open.status} -> ${open.headers.get("location")}`);
}

// The calendar subscription address: an unknown link gets a polite 404, never an error or any data.
for (const file of [`${"0".repeat(64)}.ics`, "nonsense.ics", `${"A".repeat(64)}.ics`]) {
  const feed = await fetch(`${BASE}/cal/${file}`, { redirect: "manual" });
  const text = await feed.text();
  check(feed.status === 404 && !text.includes("BEGIN:VCALENDAR"), `an unknown calendar link (${file.slice(0, 12)}…) is refused`, `status ${feed.status}`);
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
