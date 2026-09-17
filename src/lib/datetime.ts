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
