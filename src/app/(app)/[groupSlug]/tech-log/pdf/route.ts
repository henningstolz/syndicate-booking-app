import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ, formatTime } from "@/lib/datetime";
import { formatMonthKey } from "@/lib/flight-times";
import { buildFlightLogPdf, type PdfRow } from "@/lib/flight-log-pdf";
import { runningTotals } from "@/lib/flight-totals";

// The monthly flight log as a printable A4 landscape PDF:
//   /<group>/tech-log/pdf?month=2026-10
export const dynamic = "force-dynamic";

type FlightRow = {
  flight_date: string;
  brakes_off: string;
  airborne: string;
  landed: string;
  brakes_on: string;
  from_place: string;
  to_place: string;
  flight_category: string;
  captain_name: string;
  fuel_left_usg: number;
  fuel_right_usg: number;
  oil_qt: number;
  block_deci: number;
  flight_deci: number;
  check_limit_hours: number | null;
  defects: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "2-digit",
  month: "short",
});

const printedFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupSlug: string }> },
) {
  const { groupSlug } = await params;
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) {
    return NextResponse.json({ error: "Choose a month as YYYY-MM." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Row-level security only returns groups, and their log, to their members.
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const nextMonth =
    monthNumber === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;

  // Every entry up to the end of the month, oldest first, read in pages
  // (the database returns at most 1000 rows per request): the totals on the
  // printout are running sums, so the flights before the month are needed too.
  const all: FlightRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("flight_entries")
      .select(
        "flight_date, brakes_off, airborne, landed, brakes_on, from_place, to_place, flight_category, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, block_deci, flight_deci, check_limit_hours, defects, voided_at, void_reason",
      )
      .eq("group_id", group.id)
      .lt("flight_date", nextMonth)
      .order("brakes_off", { ascending: true })
      .range(from, from + 999)
      .returns<FlightRow[]>();
    if (error) {
      return NextResponse.json({ error: "Could not read the flight log." }, { status: 500 });
    }
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  // Airframe total after each flight: the baseline plus the flight time of
  // every earlier, non-voided entry. Hours to check uses the check limit
  // that applied when that flight was logged, so old printouts stay right
  // after a check resets the limit.
  const totals = runningTotals(
    all.map((entry) => ({
      flightDeci: Number(entry.flight_deci),
      voided: Boolean(entry.voided_at),
      checkLimitHours:
        entry.check_limit_hours === null ? null : Number(entry.check_limit_hours),
    })),
    group.airframe_hours_baseline,
  );

  const rows: PdfRow[] = [];
  all.forEach((entry, index) => {
    if (entry.flight_date < `${month}-01`) return; // only needed for the sums
    const voided = Boolean(entry.voided_at);
    const left = Number(entry.fuel_left_usg);
    const right = Number(entry.fuel_right_usg);
    rows.push({
      date: dayFormat.format(new Date(entry.brakes_off)),
      from: entry.from_place,
      to: entry.to_place,
      category: entry.flight_category,
      captain: entry.captain_name,
      fuelLeft: left.toFixed(1),
      fuelRight: right.toFixed(1),
      fuelTotal: (left + right).toFixed(1),
      oil: String(Number(entry.oil_qt)),
      brakesOff: formatTime(entry.brakes_off),
      airborne: formatTime(entry.airborne),
      landed: formatTime(entry.landed),
      brakesOn: formatTime(entry.brakes_on),
      blockDeci: Number(entry.block_deci).toFixed(1),
      flightDeci: Number(entry.flight_deci).toFixed(1),
      totalHours: totals[index].total === null ? "" : totals[index].total.toFixed(1),
      hoursToCheck: totals[index].toCheck === null ? "" : totals[index].toCheck.toFixed(1),
      defects: voided ? `VOID: ${entry.void_reason ?? ""}` : (entry.defects ?? ""),
      voided,
    });
  });

  const bytes = await buildFlightLogPdf({
    groupName: group.name,
    registration: group.aircraft_registration,
    aircraftType: group.aircraft_type ?? "",
    monthLabel: formatMonthKey(month),
    printedAt: printedFormat.format(new Date()).replace(" at ", ", "),
    rows,
  });

  const filename = `${group.aircraft_registration}-flight-log-${month}.pdf`.replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A private record: never cached by a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
