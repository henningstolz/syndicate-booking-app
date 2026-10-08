import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ, londonDateKey } from "@/lib/datetime";
import { formatMonthKey } from "@/lib/flight-times";
import { formatHoursTenths, formatMoney, type CostStatement, type StatementMember } from "@/lib/costs";
import {
  buildStatementPdf,
  type StatementPdfPerson,
  type StatementPdfSummaryRow,
} from "@/lib/statement-pdf";

// A month's cost statement as a printable A4 PDF:
//   /<group>/costs/pdf?month=2026-10                 your own
//   /<group>/costs/pdf?month=2026-10&member=<id>     one member (admins)
//   /<group>/costs/pdf?month=2026-10&member=all      everyone, with a summary page (admins)
// The figures come from cost_statement(), so a closed month prints exactly the
// saved figures, and a member can only ever get their own statement.
export const dynamic = "force-dynamic";

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", // a plain calendar date
  weekday: "short",
  day: "numeric",
  month: "short",
});
const shortDay = (date: string) => dayFormat.format(new Date(`${date.slice(0, 10)}T00:00:00Z`));

const stampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupSlug: string }> },
) {
  const { groupSlug } = await params;
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const who = request.nextUrl.searchParams.get("member") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "Choose a month as YYYY-MM." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Row-level security only returns groups to their members.
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const { data: raw } = await supabase.rpc("cost_statement", {
    p_group_id: group.id,
    p_month: `${month}-01`,
  });
  const s = raw as CostStatement | { result: string } | null;
  if (!s || s.result !== "ok") {
    return NextResponse.json({ error: "No statement for that month." }, { status: 404 });
  }
  const statement = s as CostStatement;

  // Who gets a statement. A member only ever gets their own.
  const everyone = who === "all";
  if ((everyone || (who !== "" && who !== user.id)) && !statement.is_admin) {
    return NextResponse.json({ error: "Only admins can print other members' statements." }, { status: 403 });
  }
  const wanted = everyone ? statement.members : statement.members.filter((m) => m.user_id === (who || user.id));
  if (wanted.length === 0) {
    return NextResponse.json({ error: "No statement for that member and month." }, { status: 404 });
  }

  const monthLabel = formatMonthKey(month);
  const thisMonth = londonDateKey(new Date()).slice(0, 7);
  const closed = statement.closed !== null;
  const status = statement.closed
    ? `Final. Closed on ${dateFormat.format(new Date(statement.closed.closed_at))} by ${statement.closed.closed_by_name}. These are the saved figures; they no longer change.${statement.closed.note ? ` Note: ${statement.closed.note}` : ""}`
    : month < thisMonth
      ? "Provisional: this month is not closed yet, so these figures can still change."
      : "Provisional: this month is still running, so these figures can still change.";

  const toPerson = (member: StatementMember): StatementPdfPerson => {
    const flights = statement.flights.filter((f) => f.user_id === member.user_id);
    const expenses = statement.expenses.filter((e) => e.user_id === member.user_id);
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
      totalLabel: member.total_pence < 0 ? `Credit due for ${monthLabel}` : `Total for ${monthLabel}`,
      total: formatMoney(Math.abs(member.total_pence)),
      note: member.custom_rates
        ? `Own rates apply: ${formatMoney(member.fee_pence)} a month and ${formatMoney(member.hourly_rate_pence)} an hour.`
        : "",
    };
  };

  const sum = (pick: (m: StatementMember) => number) => wanted.reduce((total, m) => total + pick(m), 0);
  const summary = everyone
    ? {
        rows: wanted.map(
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
          name: "To collect",
          hours: formatHoursTenths(sum((m) => m.hours_tenths)),
          fixed: formatMoney(sum((m) => m.fixed_pence)),
          flying: formatMoney(sum((m) => m.hourly_pence)),
          expenses: formatMoney(-sum((m) => m.credit_pence)),
          total: formatMoney(sum((m) => m.total_pence)),
        },
      }
    : undefined;

  const bytes = await buildStatementPdf({
    groupName: group.name,
    registration: group.aircraft_registration,
    monthLabel,
    printedAt: stampFormat.format(new Date()).replace(" at ", ", "),
    closed,
    status,
    summary,
    people: wanted.map(toPerson),
  });

  const who_ = everyone ? "everyone" : wanted[0].name;
  const filename = `${group.aircraft_registration}-statement-${month}-${who_}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A private record: never cached by a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
