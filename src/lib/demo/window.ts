// The demo is public, so a crawler can follow its Prev/Next links without end (on 18 Nov 2026 one did
// for hours: about 10,000 calendar pages, an hour of Vercel CPU). In the demo only, dates are limited to
// two years either side of today; anything further out is sent back to the page without the date.
// Real groups are behind sign-in and keep working exactly as before.

export const DEMO_WINDOW_MONTHS = 24;

// Whole months since year 0, so two "YYYY-MM" values can be compared with plain arithmetic.
function monthNumber(year: number, month: number): number {
  return year * 12 + (month - 1);
}

// "YYYY-MM" or "YYYY-MM-DD" against today's date key ("YYYY-MM-DD"). Anything that is not a date
// in that shape counts as outside, so odd values are sent back too.
export function inDemoWindow(value: string, todayKey: string): boolean {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  const [ty, tm] = todayKey.split("-").map(Number);
  return Math.abs(monthNumber(Number(m[1]), month) - monthNumber(ty, tm)) <= DEMO_WINDOW_MONTHS;
}

// A year for the reports: the same two-year limit.
export function yearInDemoWindow(year: number, todayKey: string): boolean {
  return Math.abs(year - Number(todayKey.slice(0, 4))) <= DEMO_WINDOW_MONTHS / 12;
}
