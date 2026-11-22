// Personal reminders: dates that belong to a person (medical, ratings, anything they add), shown under
// Account, Reminders. Pure and import-light, so tests can load it in plain Node. The database table is
// personal_reminders (migration 0031); only the owner can read or change their rows.
import { planItemChanges, type ListTexts } from "./list-changes.ts";

export type PersonalReminder = {
  id: string;
  label: string;
  due_date: string | null; // "YYYY-MM-DD"
  expired_text: string | null; // shown instead of plain "EXPIRED" (the IR/IMC starter item)
};

export const MAX_PERSONAL_REMINDERS = 30;
export const MAX_REMINDER_LABEL_LENGTH = 60;
// "Due soon" starts this many days before the date, as for the aircraft's dates.
export const REMINDER_SOON_DAYS = 30;

const TEXTS: ListTexts = {
  listName: "reminders",
  noun: "reminder",
  limit: (max) => `You can have at most ${max} reminders.`,
};

// What a person submitted in the Edit form, checked and tidied (the same rules as the equipment list).
export function planReminderChanges(input: {
  ids: string[];
  labels: string[];
  dues: string[];
  origLabels: string[];
  origDues: string[];
  deletedIds: string[];
}) {
  return planItemChanges({ ...input, maxItems: MAX_PERSONAL_REMINDERS, maxLabel: MAX_REMINDER_LABEL_LENGTH, texts: TEXTS });
}

export type ReminderStatus = "expired" | "soon" | "ok" | "unset";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2028-05-24" -> "Wednesday 24 May 2028"
export function formatReminderDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${DAY_NAMES[weekday]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

// Whole days from one calendar date to another ("2026-11-22", "2026-12-31" -> 39).
export function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export type ReminderView = {
  status: ReminderStatus;
  dateText: string; // "Wednesday 24 May 2028", or "Not set"
  daysText: string; // "549 days remaining", "expires today", or "" when expired or not set
  warning: string; // "EXPIRED" / "EXPIRED - DO NOT FLY IMC!", or ""
};

// How one reminder reads on the page. `todayKey` is today's UK date ("2026-11-22"). The date itself is
// still valid (it expires at the end of that day); the day after, it is expired.
export function describeReminder(item: Pick<PersonalReminder, "due_date" | "expired_text">, todayKey: string): ReminderView {
  if (!item.due_date) return { status: "unset", dateText: "Not set", daysText: "", warning: "" };
  const days = daysBetween(todayKey, item.due_date);
  const dateText = formatReminderDate(item.due_date);
  if (days < 0) return { status: "expired", dateText, daysText: "", warning: item.expired_text ?? "EXPIRED" };
  const daysText = days === 0 ? "expires today" : days === 1 ? "1 day remaining" : `${days} days remaining`;
  return { status: days <= REMINDER_SOON_DAYS ? "soon" : "ok", dateText, daysText, warning: "" };
}

// The person's own reminders that need attention (expired or due within 30 days), most urgent first: for
// the note on the dashboard.
export function reminderAlerts(items: PersonalReminder[], todayKey: string) {
  return items
    .map((item) => ({ item, view: describeReminder(item, todayKey) }))
    .filter((entry) => entry.view.status === "expired" || entry.view.status === "soon")
    .sort((a, b) => String(a.item.due_date).localeCompare(String(b.item.due_date)))
    .map(({ item, view }) => ({
      label: item.label,
      status: view.status as "expired" | "soon",
      text: view.status === "expired" ? `${item.label} has expired` : `${item.label} expires ${view.daysText === "expires today" ? "today" : `in ${view.daysText.replace(" remaining", "")}`}`,
    }));
}
