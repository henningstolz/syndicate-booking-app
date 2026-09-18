// Shared between the Aircraft page (full detail view) and the
// Dashboard (compact warning banner) so both agree on thresholds and
// labels without duplicating the logic.
export type Status = "overdue" | "soon" | "ok" | "unset";

const DUE_SOON_DAYS = 30;
const HOURS_DUE_SOON = 10;

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

export type AircraftStatusFields = {
  annual_renewal_due: string | null;
  insurance_renewal_due: string | null;
  next_check_due: string | null;
  hours_to_next_check: number | null;
};

export function statusEntries(group: AircraftStatusFields) {
  return [
    {
      label: "Annual/Permit Renewal Due",
      status: dateStatus(group.annual_renewal_due),
    },
    {
      label: "Insurance Renewal Due",
      status: dateStatus(group.insurance_renewal_due),
    },
    {
      label: "Next Check Due",
      status: dateStatus(group.next_check_due),
    },
    {
      label: "Hours To Next Check",
      status: hoursStatus(group.hours_to_next_check),
    },
  ];
}
