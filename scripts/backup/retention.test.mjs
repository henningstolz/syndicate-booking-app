import { backupsToDelete } from "./retention.mjs";

let passed = 0;
let failed = 0;
const eq = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++; else { failed++; console.log(`FAIL  ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

const day = (n) => { const d = new Date(Date.UTC(2026, 9, 8) - n * 86400000); return d.toISOString().slice(0, 10); };
const make = (days) => Array.from({ length: days }, (_, i) => ({ tag: `backup-${day(i)}`, date: day(i) }));

eq(backupsToDelete([]), [], "nothing to delete when there is nothing");
eq(backupsToDelete(make(30)), [], "30 daily backups are all kept");
eq(backupsToDelete(make(10)), [], "fewer than 30 are all kept");

// 60 days: the newest 30 stay; of the older 30, only the oldest of each month stays.
const sixty = make(60);
const gone = backupsToDelete(sixty);
const left = sixty.filter((b) => !gone.includes(b.tag)).map((b) => b.date);
eq(left.slice(0, 30), sixty.slice(0, 30).map((b) => b.date), "the newest 30 days are always kept");
eq(left.length >= 31 && left.length <= 33, true, "a few month-starters from before that are kept too");
eq(gone.every((tag) => sixty.slice(30).some((b) => b.tag === tag)), true, "only old ones are ever deleted");
eq(backupsToDelete(sixty).includes(`backup-${day(0)}`), false, "the newest backup is never deleted");

// A year and a half, one backup a day: keeps 30 daily + 12 month-starters (some overlap).
const long = make(550);
const longGone = new Set(backupsToDelete(long));
const kept = long.filter((b) => !longGone.has(b.tag));
eq(kept.length >= 38 && kept.length <= 42, true, "a long history shrinks to about 30 daily + 12 monthly");
eq(kept.some((b) => b.date === day(549)), false, "backups older than a year are dropped");
const months = new Set(kept.slice(30).map((b) => b.date.slice(0, 7)));
eq(months.size >= 11, true, "about a year of months is represented");

// Order does not matter, and gaps (days with no backup) are fine.
const shuffled = [...sixty].reverse();
eq(backupsToDelete(shuffled).sort(), backupsToDelete(sixty).sort(), "input order does not matter");
const gappy = [make(1)[0], { tag: "backup-2026-01-02", date: "2026-01-02" }];
eq(backupsToDelete(gappy), [], "a sparse history is kept");

console.log(`${passed} retention checks passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
