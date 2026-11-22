// Aircraft downtime: periods when a group's admin has marked the aircraft unavailable (maintenance, a defect,
// the annual, anything else). Pure and import-light, so tests can load it in plain Node. The database table is
// aircraft_downtime (migration 0032); the rules (no booking inside a period, cancelling the overlapping ones,
// the emails) live in the database.
import { addLondonCalendarDays, bookingDayKeys, formatDayHeading, formatTime, londonDateKey, londonWallTimeToUtc } from "./datetime.ts";

export type DowntimeReason = "maintenance" | "defect" | "annual" | "other";

export const DOWNTIME_REASONS: { value: DowntimeReason; label: string }[] = [
  { value: "maintenance", label: "Maintenance" },
  { value: "defect", label: "Defect" },
  { value: "annual", label: "Annual / permit" },
  { value: "other", label: "Other" },
];

export const MAX_DOWNTIME_NOTE = 200;

export function parseDowntimeReason(value: unknown): DowntimeReason | null {
  return DOWNTIME_REASONS.some((r) => r.value === value) ? (value as DowntimeReason) : null;
}

// "annual" -> "Annual / permit"; anything unknown is shown as "Unavailable".
export function reasonLabel(reason: unknown): string {
  return DOWNTIME_REASONS.find((r) => r.value === reason)?.label ?? "Unavailable";
}

export type DowntimePeriod = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  note: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const validDate = (key: string) => DATE.test(key) && !Number.isNaN(Date.parse(`${key}T00:00:00Z`)) && londonDateKey(new Date(`${key}T12:00:00Z`)) === key;

// What an admin typed (a from-date and a to-date, both inclusive, UK time; times optional) as the instants to
// store. Without times it is whole days: from midnight at the start of the first day to midnight at the end of
// the last. With a start time and/or an end time those apply instead on the first / last day.
export function resolveDowntimeRange(input: {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
}): { startsAt: string; endsAt: string } | { error: string } {
  const { startDate, endDate } = input;
  const startTime = (input.startTime ?? "").trim();
  const endTime = (input.endTime ?? "").trim();
  if (!validDate(startDate) || !validDate(endDate)) return { error: "Please give a from date and a to date." };
  if (startTime !== "" && !TIME.test(startTime)) return { error: "The from time is not a valid time." };
  if (endTime !== "" && !TIME.test(endTime)) return { error: "The to time is not a valid time." };
  if (endDate < startDate) return { error: "The to date cannot be before the from date." };

  const starts = londonWallTimeToUtc(startDate, startTime || "00:00");
  const ends =
    endTime !== ""
      ? londonWallTimeToUtc(endDate, endTime)
      : londonWallTimeToUtc(londonDateKey(addLondonCalendarDays(londonWallTimeToUtc(endDate, "12:00"), 1)), "00:00");
  if (ends.getTime() <= starts.getTime()) return { error: "The period must end after it starts." };
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

// Every UK calendar day a period touches (the end is exclusive: a period that ends at midnight does not touch
// the next day).
export function downtimeDayKeys(startsAt: string, endsAt: string): string[] {
  return bookingDayKeys(startsAt, new Date(new Date(endsAt).getTime() - 60_000).toISOString());
}

// "Sat 12 Dec – Tue 15 Dec" for whole days ("Sat 12 Dec" for one), with the times when it is not whole days.
export function describePeriod(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const midnight = (iso: string) => formatTime(iso) === "00:00";
  if (midnight(startsAt) && midnight(endsAt)) {
    const last = new Date(end.getTime() - 60_000);
    const first = formatDayHeading(start);
    const lastText = formatDayHeading(last);
    return first === lastText ? first : `${first} – ${lastText}`;
  }
  const sameDay = londonDateKey(start) === londonDateKey(end);
  return sameDay
    ? `${formatDayHeading(start)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`
    : `${formatDayHeading(start)} ${formatTime(startsAt)} – ${formatDayHeading(end)} ${formatTime(endsAt)}`;
}

// The periods that are on now, those still to come, and those that are over (most recent first).
export function splitPeriods<T extends { starts_at: string; ends_at: string }>(periods: T[], now: Date) {
  const t = now.getTime();
  const sorted = [...periods].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return {
    current: sorted.filter((p) => Date.parse(p.starts_at) <= t && Date.parse(p.ends_at) > t),
    upcoming: sorted.filter((p) => Date.parse(p.starts_at) > t),
    earlier: sorted.filter((p) => Date.parse(p.ends_at) <= t).reverse(),
  };
}

// For the note on the dashboard: periods that are on now or start within `days` days.
export function periodsToShow<T extends { starts_at: string; ends_at: string }>(periods: T[], now: Date, days = 14): T[] {
  const t = now.getTime();
  const horizon = t + days * 86_400_000;
  return periods
    .filter((p) => Date.parse(p.ends_at) > t && Date.parse(p.starts_at) <= horizon)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
