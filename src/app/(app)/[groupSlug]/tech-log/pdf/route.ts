import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ, formatTime } from "@/lib/datetime";
import { formatMonthKey } from "@/lib/flight-times";
import { buildFlightLogPdf, type PdfRow } from "@/lib/flight-log-pdf";

// The monthly flight log as a printable A4 landscape PDF:
//   /<group>/tech-log/pdf?month=2026-10
export const dynamic = "force-dynamic";

type FlightRow = {
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

  const { data, error } = await supabase
    .from("flight_entries")
    .select(
      "brakes_off, airborne, landed, brakes_on, from_place, to_place, flight_category, captain_name, fuel_left_usg, fuel_right_usg, oil_qt, defects, voided_at, void_reason",
    )
    .eq("group_id", group.id)
    .gte("flight_date", `${month}-01`)
    .lt("flight_date", nextMonth)
    .order("brakes_off", { ascending: true })
    .limit(1000)
    .returns<FlightRow[]>();

  if (error) {
    return NextResponse.json({ error: "Could not read the flight log." }, { status: 500 });
  }

  const rows: PdfRow[] = (data ?? []).map((entry) => {
    const left = Number(entry.fuel_left_usg);
    const right = Number(entry.fuel_right_usg);
    const voided = Boolean(entry.voided_at);
    return {
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
      defects: voided ? `VOID: ${entry.void_reason ?? ""}` : (entry.defects ?? ""),
      voided,
    };
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
