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
import { runningTotals } from "./flight-totals.ts";
import { formatMoney, parsePounds, formatHoursTenths, computeStatement, shiftMonth } from "./costs.ts";
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

// --- running airframe totals (PDF and list)
const f = (flightDeci, o = {}) => ({ flightDeci, voided: false, checkLimitHours: 5892.9, ...o });
eq(runningTotals([f(1.2), f(0.8)], 5870.4), [{ total: 5871.6, toCheck: 21.3 }, { total: 5872.4, toCheck: 20.5 }], "adds up from the baseline");
eq(runningTotals([f(1.2), f(1, { voided: true }), f(0.8)], 5870.4), [{ total: 5871.6, toCheck: 21.3 }, { total: null, toCheck: null }, { total: 5872.4, toCheck: 20.5 }], "a voided flight does not count");
eq(runningTotals([f(1.2), f(0.8)], null), [{ total: null, toCheck: null }, { total: null, toCheck: null }], "no baseline: nothing shown");
eq(runningTotals([f(1.2, { checkLimitHours: null })], 5870.4), [{ total: 5871.6, toCheck: null }], "no limit then: no hours to check");
eq(runningTotals([f(1.2, { checkLimitHours: 5892.9 }), f(1.2, { checkLimitHours: 5992.9 })], 5870.4), [{ total: 5871.6, toCheck: 21.3 }, { total: 5872.8, toCheck: 120.1 }], "each flight uses the limit remembered at its time");
eq(runningTotals([f(1.2, { checkLimitHours: 5871 })], 5870.4), [{ total: 5871.6, toCheck: -0.6 }], "past the limit goes negative");
eq(runningTotals([], 5870.4), [], "empty");
eq(runningTotals([f(0.1), f(0.1), f(0.1)], 100), [{ total: 100.1, toCheck: 5792.8 }, { total: 100.2, toCheck: 5792.7 }, { total: 100.3, toCheck: 5792.6 }], "no floating point drift");

// --- money
for (const [pence, text] of [[0, "£0.00"], [5, "£0.05"], [100, "£1.00"], [12345, "£123.45"], [100000, "£1,000.00"], [123456789, "£1,234,567.89"], [-250, "-£2.50"]])
  eq(formatMoney(pence), text, `formatMoney(${pence})`);
for (const [input, pence] of [["12", 1200], ["12.5", 1250], ["12.50", 1250], ["12,50", 1250], ["12,5", 1250], ["£1,234.50", 123450], ["1 234,50", 123450], ["1,234", 123400], ["0", 0], ["0.05", 5], ["  7.00 ", 700], ["£65", 6500]])
  eq(parsePounds(input), pence, `parsePounds(${JSON.stringify(input)})`);
for (const bad of ["", "  ", ".5", "-5", "abc", "12.345", "12.5.1", "1e3", "£", "12,50,5", "99999999999999999999", "1.2.3"])
  eq(parsePounds(bad), null, `parsePounds(${JSON.stringify(bad)}) is refused`);
eq([shiftMonth("2026-10", 1), shiftMonth("2026-12", 1), shiftMonth("2027-01", -1), shiftMonth("2026-10", -12), shiftMonth("2026-03", -3), shiftMonth("2026-10", 0)], ["2026-11", "2027-01", "2026-12", "2025-10", "2025-12", "2026-10"], "stepping through months, across new year");
eq(formatHoursTenths(125), "12.5", "hours in tenths");
eq(formatHoursTenths(0), "0.0", "zero hours");

// --- the monthly cost statement (the database does the real work; this is its twin)
const flightOf = (id, who, name, tenths, order = id) => ({ id, date: "2026-10-06", from: "A", to: "B", chargedTo: who, chargedName: name, tenths, order });
const expenseOf = (id, who, name, pence, date = "2026-10-03") => ({ id, date, description: "Fuel away", paidBy: who, paidByName: name, pence });
const inputOf = (o = {}) => ({
  month: "2026-10-01",
  rates: { feePence: 12000, hourlyPence: 6500, missing: false },
  ownRates: [],
  members: [{ userId: "a", name: "Alice" }, { userId: "b", name: "Bob" }, { userId: "c", name: "Cara" }],
  flights: [flightOf("f1", "b", "Bob", 15), flightOf("f2", "c", "Cara", 17)],
  expenses: [],
  viewer: { userId: "a", isAdmin: true },
  ...o,
});
const row = (s, id) => s.members.find((m) => m.user_id === id);
{
  const s = computeStatement(inputOf());
  eq(s.members.map((m) => [m.name, m.fixed_pence, m.hourly_pence, m.credit_pence, m.total_pence]),
    [["Alice", 12000, 0, 0, 12000], ["Bob", 12000, 9750, 0, 21750], ["Cara", 12000, 11050, 0, 23050]], "the worked example: fixed share + hours x group rate");
  eq([s.hours_tenths, s.credits_pence], [32, 0], "month totals");
  eq(Object.keys(s).includes("fuel_pence") || Object.keys(s.members[0]).includes("fuel_pence"), false, "no leftover fuel fields");
  eq([s.closed, s.can_close, s.drift], [null, false, []], "the live calculation leaves closing to its caller");
  eq(s.flights.map((f) => [f.user_id, f.hours_tenths, f.pence]), [["b", 15, 9750], ["c", 17, 11050]], "flights with their charge");
  eq(s.members.map((m) => m.custom_rates), [false, false, false], "nobody has their own rates");
}
{
  const s = computeStatement(inputOf({ viewer: { userId: "b", isAdmin: false } }));
  eq([s.is_admin, s.members.map((m) => m.name), s.flights.map((f) => f.user_id)], [false, ["Bob"], ["b"]], "a member sees only their own statement and flights");
  eq(s.hours_tenths, 32, "...with the month's hours");
}
{
  // Own rates: Bob owns no share (no fixed costs) but pays more per hour; Cara only has a different fixed share.
  const s = computeStatement(inputOf({ ownRates: [{ userId: "b", feePence: 0, hourlyPence: 9000 }, { userId: "c", feePence: 5000, hourlyPence: null }] }));
  eq([row(s, "b").fixed_pence, row(s, "b").hourly_pence, row(s, "b").total_pence, row(s, "b").custom_rates], [0, 13500, 13500, true], "own rates: no fixed share (0), higher hourly rate");
  eq([row(s, "c").fixed_pence, row(s, "c").hourly_pence, row(s, "c").hourly_rate_pence, row(s, "c").custom_rates], [5000, 11050, 6500, true], "an empty part follows the group's rate");
  eq([row(s, "a").fixed_pence, row(s, "a").custom_rates], [12000, false], "everyone else on the group rate");
  eq(s.flights.map((f) => f.pence), [13500, 11050], "flights are charged at the pilot's own rate");
  const t = computeStatement(inputOf({ ownRates: [{ userId: "b", feePence: null, hourlyPence: null }] }));
  eq(row(t, "b").custom_rates, false, "an own-rate row with nothing set is not custom");
}
{
  // Expenses are credited to the member who paid.
  const s = computeStatement(inputOf({ expenses: [expenseOf("e1", "b", "Bob", 8000), expenseOf("e2", "b", "Bob", 1250, "2026-10-05")] }));
  eq([row(s, "b").credit_pence, row(s, "b").total_pence, s.credits_pence], [9250, 21750 - 9250, 9250], "expenses reduce the member's total");
  eq(s.expenses.map((e) => e.id), ["e1", "e2"], "expenses listed by date");
  const own = computeStatement(inputOf({ viewer: { userId: "c", isAdmin: false }, expenses: [expenseOf("e1", "b", "Bob", 8000)] }));
  eq([own.expenses.length, own.credits_pence], [0, 8000], "a member does not see others' expenses, but the month's total counts them");
}
{
  // Expenses bigger than the bill: the total goes negative (a credit to the member).
  const s = computeStatement(inputOf({ flights: [], expenses: [expenseOf("e1", "a", "Alice", 50000)] }));
  eq(row(s, "a").total_pence, 12000 - 50000, "a negative total means money owed to the member");
}
{
  const s = computeStatement(inputOf({ flights: [flightOf("f1", "x", "Visitor", 10), flightOf("f2", "b", "Bob", 10)], expenses: [expenseOf("e1", "y", "Gone", 500)] }));
  eq(s.members.map((m) => [m.name, m.is_member, m.fixed_pence, m.total_pence]), [["Alice", true, 12000, 12000], ["Bob", true, 12000, 18500], ["Gone", false, 0, -500], ["Cara", true, 12000, 12000], ["Visitor", false, 0, 6500]].sort((p, q) => (p[0] < q[0] ? -1 : 1)), "someone charged or paid who is not a member pays no fixed share");
}
{
  const s = computeStatement(inputOf({ rates: { feePence: 0, hourlyPence: 6505, missing: false }, flights: [flightOf("f1", "b", "Bob", 1), flightOf("f2", "b", "Bob", 2)] }));
  eq([s.flights.map((f) => f.pence), row(s, "b").hourly_pence], [[651, 1301], 1952], "each flight rounded half up to a penny; the member's total is their sum");
}
eq(computeStatement(inputOf({ rates: { feePence: 0, hourlyPence: 0, missing: true } })).rates, { fee_pence: 0, hourly_pence: 0, missing: true }, "missing rates are flagged");

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
