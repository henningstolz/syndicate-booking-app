export const LONDON_TZ = "Europe/London";

// "en-CA" conveniently formats as YYYY-MM-DD, used both as a map key
// for grouping bookings by day and as an <input type="date"> default.
export function londonDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON_TZ }).format(
    date,
  );
}

export function formatDayHeading(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function londonOffsetMinutes(utcGuess: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: LONDON_TZ,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(utcGuess)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - utcGuess.getTime()) / 60_000;
}

// Bookings are entered as plain "wall clock in the UK" (a date picker
// plus a time, with no timezone attached) regardless of what timezone
// the server process itself runs in (Vercel defaults to UTC) — this
// converts that wall-clock time to the correct UTC instant, handling
// the GMT/BST switch rather than assuming a fixed offset.
export function londonWallTimeToUtc(dateStr: string, timeStr: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const offsetMinutes = londonOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}

// Adds calendar days to a date, by the London calendar, safely across
// the GMT/BST switch. A plain `date.getTime() + n * 86_400_000` breaks
// on the day clocks change (25 real hours going into GMT, 23 going
// into BST) — e.g. stepping 24h at a time through the day clocks fall
// back renders the same calendar date twice and skips the next one.
export function addLondonCalendarDays(date: Date, days: number): Date {
  const [year, month, day] = londonDateKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days));
}

// Every calendar date a booking spans (inclusive), so a multi-day
// booking can be shown on each day it blocks the aircraft for, not
// just the day it starts.
export function bookingDayKeys(startsAt: string, endsAt: string): string[] {
  const [sy, sm, sd] = londonDateKey(new Date(startsAt)).split("-").map(Number);
  const [ey, em, ed] = londonDateKey(new Date(endsAt)).split("-").map(Number);
  const end = Date.UTC(ey, em - 1, ed);

  const keys: string[] = [];
  let cursor = Date.UTC(sy, sm - 1, sd);
  while (cursor <= end) {
    keys.push(londonDateKey(new Date(cursor)));
    cursor = Date.UTC(
      new Date(cursor).getUTCFullYear(),
      new Date(cursor).getUTCMonth(),
      new Date(cursor).getUTCDate() + 1,
    );
  }
  return keys;
}
