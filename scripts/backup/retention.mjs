// Which old backups to delete. Keeps the newest 30 days of daily backups, plus
// the oldest backup of each of the last 12 months, so there is always a recent
// copy and a coarser history going back a year. Pure, so it is tested.
//
// backups: [{ tag: "backup-2026-10-08", date: "2026-10-08" }, ...]  ->  tags to delete
export function backupsToDelete(backups, { daily = 30, months = 12 } = {}) {
  const newestFirst = [...backups].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const keep = new Set(newestFirst.slice(0, daily).map((b) => b.tag));

  // The oldest backup in each month, for the most recent `months` months that have one.
  const firstOfMonth = new Map();
  for (const b of [...newestFirst].reverse()) {
    const month = b.date.slice(0, 7);
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, b.tag);
  }
  const recentMonths = [...firstOfMonth.keys()].sort().reverse().slice(0, months);
  for (const month of recentMonths) keep.add(firstOfMonth.get(month));

  return newestFirst.filter((b) => !keep.has(b.tag)).map((b) => b.tag);
}

// Command line use, from the backup workflow: reads `gh release list --json
// tagName,createdAt` on stdin, prints the tags to delete, one per line.
if (import.meta.url === `file://${process.argv[1]}`) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const releases = JSON.parse(input)
    .filter((r) => /^backup-\d{4}-\d{2}-\d{2}$/.test(r.tagName))
    .map((r) => ({ tag: r.tagName, date: r.tagName.slice("backup-".length) }));
  for (const tag of backupsToDelete(releases)) console.log(tag);
}
