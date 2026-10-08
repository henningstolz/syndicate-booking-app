// Turns a cost statement (what cost_statement() returns) into the ready-made
// text the PDF builder prints. Shared by the PDF download and by the emailed
// statement, so both print exactly the same thing. Pure; relative imports with
// .ts extensions so the tests can run it in plain Node.
import { formatHoursTenths, formatMoney, type CostStatement, type StatementMember } from "./costs.ts";
import type { StatementPdfInput, StatementPdfPerson, StatementPdfSummaryRow } from "./statement-pdf.ts";

const LONDON = "Europe/London";

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", // a plain calendar date
  weekday: "short",
  day: "numeric",
  month: "short",
});
const shortDay = (date: string) => dayFormat.format(new Date(`${date.slice(0, 10)}T00:00:00Z`));

const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, day: "numeric", month: "short", year: "numeric" });

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// "2026-10" -> "October 2026"
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

export type StatementPdfContext = {
  groupName: string;
  registration: string;
  month: string; // "2026-10"
  thisMonth: string; // the current UK month, "2026-10"
  printedAt: string; // "8 Oct 2026, 14:05"
};

export function statementStatus(statement: CostStatement, ctx: Pick<StatementPdfContext, "month" | "thisMonth">): string {
  if (statement.closed) {
    const note = statement.closed.note ? ` Note: ${statement.closed.note}` : "";
    return `Final. Closed on ${dateFormat.format(new Date(statement.closed.closed_at))} by ${statement.closed.closed_by_name}. These are the saved figures; they no longer change.${note}`;
  }
  return ctx.month < ctx.thisMonth
    ? "Provisional: this month is not closed yet, so these figures can still change."
    : "Provisional: this month is still running, so these figures can still change.";
}

function toPerson(statement: CostStatement, member: StatementMember, label: string): StatementPdfPerson {
  const flights = statement.flights.filter((f) => f.user_id === member.user_id);
  const expenses = statement.expenses.filter((e) => e.user_id === member.user_id);
  // Payments are only printed once there are some (a statement made at closing time has none).
  const payments = (statement.payments ?? []).filter((p) => p.user_id === member.user_id);
  const balance = member.balance_pence ?? member.total_pence;
  return {
    name: member.name,
    notAMember: !member.is_member,
    fixedLabel: "Fixed monthly share",
    fixed: formatMoney(member.fixed_pence),
    flyingLabel: `Flying: ${formatHoursTenths(member.hours_tenths)} block hours at ${formatMoney(member.hourly_rate_pence)} an hour`,
    flying: formatMoney(member.hourly_pence),
    flights: flights.map((f) => ({
      date: shortDay(f.date),
      route: `${f.from} to ${f.to}`,
      hours: formatHoursTenths(f.hours_tenths),
      charge: formatMoney(f.pence),
    })),
    expenses: expenses.map((e) => ({ date: shortDay(e.date), description: e.description, amount: formatMoney(-e.pence) })),
    expensesTotal: expenses.length > 0 ? formatMoney(-member.credit_pence) : "",
    totalLabel: member.total_pence < 0 ? `Credit due for ${label}` : `Total for ${label}`,
    total: formatMoney(Math.abs(member.total_pence)),
    payments: payments.map((p) => ({ date: shortDay(p.paid_on), note: p.note ?? "", amount: formatMoney(-p.amount_pence) })),
    paymentsTotal: formatMoney(-(member.paid_pence ?? 0)),
    balanceLabel: balance === 0 ? "Settled" : balance > 0 ? "Still to pay" : "Credit still due",
    balance: formatMoney(Math.abs(balance)),
    note: member.custom_rates
      ? `Own rates apply: ${formatMoney(member.fee_pence)} a month and ${formatMoney(member.hourly_rate_pence)} an hour.`
      : "",
  };
}

// `members` are the people to print (one for a single statement, all for the
// everyone download); `everyone` adds the summary page.
export function statementPdfInput(
  statement: CostStatement,
  members: StatementMember[],
  ctx: StatementPdfContext,
  everyone: boolean,
): StatementPdfInput {
  const label = monthLabel(ctx.month);
  const sum = (pick: (m: StatementMember) => number) => members.reduce((total, m) => total + pick(m), 0);
  const summary = everyone
    ? {
        rows: members.map(
          (m): StatementPdfSummaryRow => ({
            name: m.is_member ? m.name : `${m.name} (not a member)`,
            hours: formatHoursTenths(m.hours_tenths),
            fixed: formatMoney(m.fixed_pence),
            flying: formatMoney(m.hourly_pence),
            expenses: formatMoney(-m.credit_pence),
            total: formatMoney(m.total_pence),
          }),
        ),
        totals: {
          name: "Total",
          hours: formatHoursTenths(sum((m) => m.hours_tenths)),
          fixed: formatMoney(sum((m) => m.fixed_pence)),
          flying: formatMoney(sum((m) => m.hourly_pence)),
          expenses: formatMoney(-sum((m) => m.credit_pence)),
          total: formatMoney(sum((m) => m.total_pence)),
        },
      }
    : undefined;

  return {
    groupName: ctx.groupName,
    registration: ctx.registration,
    monthLabel: label,
    printedAt: ctx.printedAt,
    closed: statement.closed !== null,
    status: statementStatus(statement, ctx),
    summary,
    people: members.map((m) => toPerson(statement, m, label)),
  };
}
