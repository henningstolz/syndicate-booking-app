// Plain unit tests for the pure helpers in src/lib. Run with: npm run test:unit
import assert from "node:assert/strict";
import { safeNextPath } from "./safe-next-path.ts";
import { pickGroupSlug } from "./pick-group.ts";
import { wallTimesToUtcIso } from "./datetime.ts";
import {
  minutesToDeci, timeToMinutes, dayOffsets, flightDurations, formatDuration, formatDeci,
  formatMonthKey, monthKeysDescending,
} from "./flight-times.ts";
import { buildFlightLogPdf } from "./flight-log-pdf.ts";
import { PDFDocument } from "pdf-lib";

let count = 0;
const eq = (got, want, label) => { assert.deepEqual(got, want, label); count++; };

// --- safeNextPath: email links may only send people to paths on our own site
for (const [input, want] of [
  ["/reset-password", "/reset-password"], ["/join/abc-123", "/join/abc-123"],
  [null, "/login"], [undefined, "/login"], ["", "/login"],
  ["//evil.com", "/login"], ["@evil.com", "/login"], ["https://evil.com", "/login"],
  ["/\\evil.com", "/login"], ["evil.com", "/login"], ["/ok\nSet-Cookie: x", "/login"],
]) eq(safeNextPath(input), want, `safeNextPath(${JSON.stringify(input)})`);

// --- pickGroupSlug: which group to open at sign-in
eq(pickGroupSlug(["a", "b", "c"], "b"), "b", "remembered group");
eq(pickGroupSlug(["a", "b", "c"], "zzz"), "a", "unknown remembered -> oldest");
eq(pickGroupSlug(["a", "b"], null), "a", "nothing remembered");
eq(pickGroupSlug([], "x"), null, "in no group");

// --- the paper conversion table (minutes -> decimal hours)
for (const [m, d] of Object.entries({ 0: 0, 5: 0.1, 10: 0.2, 15: 0.3, 20: 0.3, 25: 0.4, 30: 0.5, 35: 0.6, 40: 0.7, 45: 0.8, 50: 0.8, 55: 0.9, 60: 1, 72: 1.2, 90: 1.5, 96: 1.6 }))
  eq(minutesToDeci(Number(m)), d, `${m} min`);

// --- times
eq(timeToMinutes("09:10"), 550, "09:10");
eq(timeToMinutes("00:00"), 0, "midnight");
eq(timeToMinutes("23:59"), 1439, "23:59");
for (const bad of ["24:00", "9:10", "09:60", "", "ab:cd", "09:10:00", null]) eq(timeToMinutes(bad ?? ""), null, `bad time ${bad}`);

eq(dayOffsets(["09:10", "09:18", "10:30", "10:40"]), [0, 0, 0, 0], "same day");
eq(dayOffsets(["23:30", "23:40", "00:10", "00:20"]), [0, 0, 1, 1], "past midnight");
eq(dayOffsets(["23:50", "00:05", "00:40", "00:50"]), [0, 1, 1, 1], "past midnight early");
eq(dayOffsets(["09:10", "", "10:30", "10:40"]), null, "missing time");

eq(flightDurations(["09:10", "09:18", "10:30", "10:40"]), { flightMinutes: 72, blockMinutes: 90, flightDeci: 1.2, blockDeci: 1.5 }, "typical flight");
eq(flightDurations(["23:30", "23:40", "00:10", "00:20"]), { flightMinutes: 30, blockMinutes: 50, flightDeci: 0.5, blockDeci: 0.8 }, "flight across midnight");
eq(flightDurations(["09:10", "09:18", "10:30"]), null, "needs four times");

eq(formatDuration(72), "1:12", "1:12");
eq(formatDuration(5), "0:05", "0:05");
eq(formatDuration(600), "10:00", "10:00");
eq(formatDeci(1.2), "1.2", "1.2");
eq(formatDeci(3), "3.0", "3.0");

// --- UK clock times -> stored instants (summer = BST = UTC+1, winter = UTC)
eq(wallTimesToUtcIso("2026-10-04", ["09:10", "09:18", "10:30", "10:40"], [0, 0, 0, 0]),
  ["2026-10-04T08:10:00.000Z", "2026-10-04T08:18:00.000Z", "2026-10-04T09:30:00.000Z", "2026-10-04T09:40:00.000Z"], "BST day");
eq(wallTimesToUtcIso("2026-01-14", ["09:10", "09:18", "10:30", "10:40"], [0, 0, 0, 0]),
  ["2026-01-14T09:10:00.000Z", "2026-01-14T09:18:00.000Z", "2026-01-14T10:30:00.000Z", "2026-01-14T10:40:00.000Z"], "GMT day");
eq(wallTimesToUtcIso("2026-10-04", ["23:30", "23:40", "00:10", "00:20"], [0, 0, 1, 1]),
  ["2026-10-04T22:30:00.000Z", "2026-10-04T22:40:00.000Z", "2026-10-04T23:10:00.000Z", "2026-10-04T23:20:00.000Z"], "past midnight (BST)");
// Clocks go back on Sunday 25 Oct 2026 (01:00 UTC): 00:30 BST is 23:30Z the day before, 02:10 GMT is 02:10Z.
eq(wallTimesToUtcIso("2026-10-24", ["23:30", "23:40", "00:10", "00:20"], [0, 0, 1, 1]),
  ["2026-10-24T22:30:00.000Z", "2026-10-24T22:40:00.000Z", "2026-10-24T23:10:00.000Z", "2026-10-24T23:20:00.000Z"], "night before the clocks go back");
eq(wallTimesToUtcIso("2026-10-25", ["09:00", "09:05", "10:00", "10:10"], [0, 0, 0, 0]),
  ["2026-10-25T09:00:00.000Z", "2026-10-25T09:05:00.000Z", "2026-10-25T10:00:00.000Z", "2026-10-25T10:10:00.000Z"], "morning after clocks went back (GMT)");

// --- months for the PDF picker
eq(formatMonthKey("2026-10"), "October 2026", "month label");
eq(formatMonthKey("2027-01"), "January 2027", "January label");
eq(monthKeysDescending("2026-08", "2026-10"), ["2026-10", "2026-09", "2026-08"], "three months");
eq(monthKeysDescending("2025-11", "2026-02"), ["2026-02", "2026-01", "2025-12", "2025-11"], "across new year");
eq(monthKeysDescending("2026-10", "2026-10"), ["2026-10"], "single month");
eq(monthKeysDescending("2027-05", "2026-10"), ["2026-10"], "first after last falls back to last");
eq(monthKeysDescending("1900-01", "2026-10").length, 120, "capped");

// --- the PDF: A4 landscape, grows pages, survives characters the font lacks
const sample = (i, o = {}) => ({
  date: "04 Oct", from: "EGLM", to: "EGLM", category: "PV", captain: `Pilot ${i}`,
  fuelLeft: "24.0", fuelRight: "23.5", fuelTotal: "47.5", oil: "7",
  brakesOff: "09:10", airborne: "09:18", landed: "10:30", brakesOn: "10:40",
  defects: "", voided: false, ...o,
});
const pdfInput = (rows) => ({ groupName: "G-BBFD Syndicate", registration: "G-BBFD", aircraftType: "PA28R 200-II", monthLabel: "October 2026", printedAt: "6 Oct 2026, 14:05", rows });
const open = async (rows) => PDFDocument.load(await buildFlightLogPdf(pdfInput(rows)));
const onePage = await open([sample(1)]);
eq(onePage.getPageCount(), 1, "one flight -> one page");
eq([Math.round(onePage.getPage(0).getWidth()), Math.round(onePage.getPage(0).getHeight())], [842, 595], "A4 landscape");
eq((await open([])).getPageCount(), 1, "empty month -> one page");
const many = await open(Array.from({ length: 60 }, (_, i) => sample(i)));
eq(many.getPageCount() > 1, true, "60 flights -> several pages");
const odd = await open([sample(1, { captain: "Zoë Müller 😀 ł 漢字", defects: "tab\there → arrow … ellipsis \u0000 nul" , voided: true})]);
eq(odd.getPageCount(), 1, "characters the font lacks do not break the PDF");
const longNote = await open([sample(1, { defects: "word ".repeat(600) })]);
eq(longNote.getPageCount(), 1, "a very long defect note stays on one page");
const manyBreaks = await open([sample(1, { defects: "x\n".repeat(1000) }), sample(2)]);
eq(manyBreaks.getPageCount() <= 2, true, "a note of a thousand line breaks cannot run off the page");

console.log(`${count} unit checks passed`);
