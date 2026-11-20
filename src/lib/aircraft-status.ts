// Single source of truth for the aircraft status fields, shared by the
// Aircraft page (display + edit form + save action), the group query
// that loads them, and the Dashboard warning banner. Adding a field
// means one new entry here plus a database column.
export type Status = "overdue" | "soon" | "ok" | "unset";

const DUE_SOON_DAYS = 30;
const HOURS_DUE_SOON = 10;

export const STATUS_FIELDS = [
  { column: "annual_renewal_due", label: "Annual/Permit Renewal Due", kind: "date" },
  { column: "insurance_renewal_due", label: "Insurance Renewal Due", kind: "date" },
  { column: "next_check_due", label: "Next Check Due", kind: "date" },
  { column: "hours_to_next_check", label: "Hours To Next Check", kind: "hours" },
] as const;

// The equipment list each group customises (life raft, first aid kit, ...): a name and a due date
// each, stored in the aircraft_items table (migration 0028).
export type AircraftItem = { id: string; label: string; due_date: string | null };
export const MAX_AIRCRAFT_ITEMS = 30;
export const MAX_ITEM_LABEL_LENGTH = 60;

export type StatusColumn = (typeof STATUS_FIELDS)[number]["column"];

// Dates arrive as "YYYY-MM-DD" strings, hours as numbers.
export type AircraftStatusFields = Record<StatusColumn, string | number | null>;

export function dateStatus(dateStr: string | null): Status {
  if (!dateStr) return "unset";
  const daysUntil =
    (new Date(`${dateStr}T00:00:00Z`).getTime() - Date.now()) / 86_400_000;
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= DUE_SOON_DAYS) return "soon";
  return "ok";
}

export function hoursStatus(hours: number | null): Status {
  if (hours === null) return "unset";
  if (hours <= 0) return "overdue";
  if (hours <= HOURS_DUE_SOON) return "soon";
  return "ok";
}

export function fieldStatus(
  kind: (typeof STATUS_FIELDS)[number]["kind"],
  value: string | number | null,
): Status {
  return kind === "date"
    ? dateStatus(value as string | null)
    : hoursStatus(value as number | null);
}

export function statusEntries(group: AircraftStatusFields, items: AircraftItem[] = []) {
  return [
    ...STATUS_FIELDS.map((field) => ({
      label: field.label,
      status: fieldStatus(field.kind, group[field.column]),
    })),
    ...items.map((item) => ({
      label: item.label,
      status: dateStatus(item.due_date),
    })),
  ];
}
