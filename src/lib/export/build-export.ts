// Builds the files of a group's data export from the rows the admin may read. Pure: rows in, text out.
// Members are named by display name only (no email addresses), money is in pence with a pounds column,
// and times are as the database stores them (UTC). Not included on purpose: invitations and calendar
// links (they are secrets), feedback and notification choices (personal), and the uploaded files
// themselves (listed in documents.csv; they stay downloadable on the Documents page).
import { zipSync, strToU8 } from "fflate";
import { toCsv } from "./csv.ts";

type Row = Record<string, unknown>;

export type ExportData = {
  generatedAt: string; // ISO time
  group: Row;
  members: Row[];
  bookings: Row[];
  flights: Row[];
  chat: Row[];
  rates: Row[];
  expenses: Row[];
  payments: Row[];
  closures: Row[];
  documents: Row[];
};

const pounds = (pence: unknown): number | null => (typeof pence === "number" ? pence / 100 : null);

export const AIRCRAFT_LABELS: [string, string][] = [
  ["name", "Group name"],
  ["slug", "Group address name"],
  ["aircraft_registration", "Registration"],
  ["aircraft_type", "Type"],
  ["home_base", "Home base"],
  ["created_at", "Group created"],
  ["airframe_total_hours", "Airframe total hours"],
  ["next_check_at_hours", "Next check at (airframe hours)"],
  ["hours_to_next_check", "Hours to next check"],
  ["next_check_due", "Next check due (date)"],
  ["annual_renewal_due", "Annual renewal due"],
  ["insurance_renewal_due", "Insurance renewal due"],
  ["life_raft_due", "Life raft due"],
  ["life_vests_due", "Life vests due"],
  ["fire_extinguisher_due", "Fire extinguisher due"],
];

export function buildExportFiles(data: ExportData): Record<string, string> {
  const names = new Map<string, string>();
  for (const m of data.members) {
    if (typeof m.user_id === "string") names.set(m.user_id, typeof m.display_name === "string" && m.display_name ? m.display_name : "Member");
  }
  const who = (id: unknown): string => (typeof id === "string" ? (names.get(id) ?? "Former member") : "");

  const files: Record<string, string> = {};

  files["members.csv"] = toCsv(
    ["name", "role", "joined", "left"],
    data.members.map((m) => [who(m.user_id), m.role, m.created_at, m.removed_at]),
  );

  files["bookings.csv"] = toCsv(
    ["booked_by", "starts_at", "ends_at", "status", "note", "created_at", "cancelled_at", "cancelled_by"],
    data.bookings.map((b) => [who(b.member_id), b.starts_at, b.ends_at, b.status, b.note, b.created_at, b.cancelled_at, who(b.cancelled_by)]),
  );

  files["flight_log.csv"] = toCsv(
    ["date", "from", "to", "category", "captain", "fuel_left_usg", "fuel_right_usg", "oil_qt", "brakes_off", "airborne", "landed", "brakes_on",
      "block_minutes", "flight_minutes", "block_hours_tenths", "flight_hours_tenths", "defects", "entered_by", "entered_at", "voided", "voided_at", "voided_by", "void_reason"],
    data.flights.map((f) => [
      f.flight_date, f.from_place, f.to_place, f.flight_category, f.captain_id ? who(f.captain_id) : f.captain_name,
      f.fuel_left_usg, f.fuel_right_usg, f.oil_qt, f.brakes_off, f.airborne, f.landed, f.brakes_on,
      f.block_minutes, f.flight_minutes, f.block_deci, f.flight_deci, f.defects, who(f.created_by), f.created_at,
      f.voided_at !== null && f.voided_at !== undefined, f.voided_at, who(f.voided_by), f.void_reason,
    ]),
  );

  files["chat.csv"] = toCsv(["time", "author", "message"], data.chat.map((c) => [c.created_at, who(c.author_id), c.message]));

  files["costs_rates.csv"] = toCsv(
    ["from_month", "applies_to", "monthly_fee_pence", "hourly_rate_pence", "monthly_fee_gbp", "hourly_rate_gbp", "set_by", "set_at"],
    data.rates.map((r) => [r.effective_month, r.user_id ? who(r.user_id) : "Whole group", r.monthly_fee_pence, r.hourly_rate_pence,
      pounds(r.monthly_fee_pence), pounds(r.hourly_rate_pence), who(r.created_by), r.created_at]),
  );

  files["costs_expenses.csv"] = toCsv(
    ["date", "paid_by", "description", "amount_pence", "amount_gbp", "has_receipt", "entered_by", "entered_at", "voided", "voided_at", "voided_by", "void_reason"],
    data.expenses.map((e) => [e.incurred_on, who(e.paid_by), e.description, e.amount_pence, pounds(e.amount_pence), Boolean(e.document_id),
      who(e.created_by), e.created_at, e.voided_at !== null && e.voided_at !== undefined, e.voided_at, who(e.voided_by), e.void_reason]),
  );

  files["costs_payments.csv"] = toCsv(
    ["month", "member", "amount_pence", "amount_gbp", "paid_on", "note", "entered_by", "entered_at", "voided", "voided_at", "voided_by", "void_reason"],
    data.payments.map((p) => [p.month, who(p.user_id), p.amount_pence, pounds(p.amount_pence), p.paid_on, p.note, who(p.created_by), p.created_at,
      p.voided_at !== null && p.voided_at !== undefined, p.voided_at, who(p.voided_by), p.void_reason]),
  );

  files["costs_closed_months.csv"] = toCsv(
    ["month", "closed_at", "closed_by", "note", "reopened_at", "reopen_reason"],
    data.closures.map((c) => [c.month, c.closed_at, who(c.closed_by), c.note, c.reopened_at, c.reopen_reason]),
  );

  // The saved statements of the closed months, one row per member.
  const statementRows: unknown[][] = [];
  for (const c of data.closures) {
    const snapshot = c.snapshot as { members?: Row[] } | null;
    for (const m of snapshot?.members ?? []) {
      statementRows.push([c.month, c.reopened_at !== null && c.reopened_at !== undefined ? "reopened" : "closed", m.name, m.flights, m.hours_tenths,
        m.fixed_pence, m.hourly_pence, m.credit_pence, m.total_pence, pounds(m.total_pence)]);
    }
  }
  files["costs_statements.csv"] = toCsv(
    ["month", "state", "member", "flights", "hours_tenths", "fixed_pence", "flying_pence", "expenses_credited_pence", "total_pence", "total_gbp"],
    statementRows,
  );

  files["aircraft.csv"] = toCsv(
    ["field", "value"],
    AIRCRAFT_LABELS.filter(([key]) => key in data.group).map(([key, label]) => [label, data.group[key]]),
  );

  files["documents.csv"] = toCsv(
    ["title", "category", "file_name", "type", "size_bytes", "uploaded_by", "uploaded_at"],
    data.documents.map((d) => [d.title, d.category, d.file_name, d.content_type, d.size_bytes, who(d.uploaded_by), d.created_at]),
  );

  files["README.txt"] = [
    `Blocktime data export for ${typeof data.group.name === "string" ? data.group.name : "your group"}`,
    `Made on ${data.generatedAt} (times in the files are UTC unless a column says otherwise).`,
    "",
    "members.csv            who is or was in the group (names only, no email addresses)",
    "bookings.csv           every booking, including cancelled ones",
    "flight_log.csv         every tech log entry, including voided ones with their reason",
    "chat.csv               the group chat",
    "costs_rates.csv       the monthly share and hourly rates, from the month they apply",
    "costs_expenses.csv    expenses paid by members, including voided ones",
    "costs_payments.csv    payments recorded against closed months, including voided ones",
    "costs_closed_months.csv  which months were closed (and reopened)",
    "costs_statements.csv  the saved statement of each closed month, one row per member",
    "aircraft.csv          the aircraft and the group's due dates",
    "documents.csv         the list of uploaded documents and receipts",
    "",
    "The uploaded files themselves are not in this export. Download them one by one on the Documents page,",
    "or write to support@blocktime.group.",
    "Money is in pence, with a pounds column where it helps. The CSV files open in Excel, Numbers and Google Sheets.",
    "",
  ].join("\r\n");

  return files;
}

// The files as a ZIP.
export function zipFiles(files: Record<string, string>, madeAt: Date): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const name of Object.keys(files).sort()) entries[name] = [strToU8(files[name]), { mtime: madeAt }];
  return zipSync(entries);
}
