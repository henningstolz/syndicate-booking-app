import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { londonDateKey, formatDayHeading, formatTime } from "@/lib/datetime";
import { DistributionChart } from "./DistributionChart";
import { DistributionControls } from "./DistributionControls";
import {
  bookingYearRange,
  loadDistribution,
  type Metric,
} from "./distribution";

type MemberRow = { user_id: string; display_name: string | null };

type BookingRow = {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

type ReportView = "all" | "mine" | "distribution";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ view?: string; metric?: string; year?: string }>;
}) {
  const { groupSlug } = await params;
  const { view, metric: metricParam, year: yearParam } = await searchParams;
  const activeView: ReportView =
    view === "mine" || view === "distribution" ? view : "all";
  const metric: Metric = metricParam === "days" ? "days" : "bookings";

  const supabase = await createClient();
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentYear = Number(londonDateKey(new Date()).slice(0, 4));
  // Period for the distribution report: a specific year, or null for
  // all time. Defaults to the current year when absent or unusable.
  const selectedYear: number | null =
    yearParam === "all"
      ? null
      : /^\d{4}$/.test(yearParam ?? "")
        ? Number(yearParam)
        : currentYear;

  const membersQuery = supabase
    .from("group_members")
    .select("user_id, display_name")
    .eq("group_id", group.id)
    .order("created_at")
    .returns<MemberRow[]>();

  let content: React.ReactNode;
  let memberList: MemberRow[];

  if (activeView === "distribution") {
    const [{ data: members }, yearRange] = await Promise.all([
      membersQuery,
      bookingYearRange(supabase, group.id),
    ]);
    memberList = members ?? [];

    // Offer every year from the first booking to now (or the last
    // booking, if it's in the future) — plus the selected one, so a
    // hand-edited URL still shows where you are.
    const firstYear = Math.min(yearRange?.first ?? currentYear, selectedYear ?? currentYear);
    const lastYear = Math.max(yearRange?.last ?? currentYear, currentYear, selectedYear ?? currentYear);
    const years = Array.from(
      { length: lastYear - firstYear + 1 },
      (_, i) => firstYear + i,
    );

    const slices = await loadDistribution(
      supabase,
      group.id,
      memberList,
      metric,
      selectedYear,
    );

    const periodLabel = selectedYear === null ? "all time" : `in ${selectedYear}`;

    content = (
      <div className="flex flex-col gap-4">
        <DistributionControls
          groupSlug={groupSlug}
          metric={metric}
          year={selectedYear}
          years={years}
        />
        <p className="text-sm text-zinc-500">
          {metric === "bookings"
            ? `Confirmed bookings starting ${periodLabel}, past and upcoming. A multi-day booking counts once.`
            : `Calendar days each member has a booking on, ${periodLabel}. A half day counts as a day, and a multi-day booking counts every day it spans.`}
        </p>
        <DistributionChart
          slices={slices}
          unit={metric === "bookings" ? "bookings" : "days"}
          periodLabel={periodLabel}
        />
      </div>
    );
  } else {
    let bookingsQuery = supabase
      .from("bookings")
      .select("id, member_id, starts_at, ends_at, note")
      .eq("group_id", group.id)
      .eq("status", "confirmed")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at");

    if (activeView === "mine" && user) {
      bookingsQuery = bookingsQuery.eq("member_id", user.id);
    }

    const [{ data: members }, { data: bookings }] = await Promise.all([
      membersQuery,
      bookingsQuery.returns<BookingRow[]>(),
    ]);
    memberList = members ?? [];

    const memberIndex = new Map(memberList.map((m, i) => [m.user_id, i]));
    const memberName = (userId: string) =>
      memberList.find((m) => m.user_id === userId)?.display_name ?? "Member";

    content =
      !bookings || bookings.length === 0 ? (
        <p className="text-sm text-zinc-500">No upcoming bookings.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {bookings.map((booking) => {
            const colorIndex = memberIndex.get(booking.member_id) ?? 0;
            const startDay = new Date(booking.starts_at);
            const endDay = new Date(booking.ends_at);
            const spansMultipleDays =
              londonDateKey(startDay) !== londonDateKey(endDay);

            return (
              <div
                key={booking.id}
                className={`flex flex-col gap-0.5 rounded-lg border-l-4 bg-white px-3 py-2 shadow-sm ${memberColor(colorIndex).border}`}
              >
                <span className="font-mono text-xs text-zinc-500">
                  {formatDayHeading(startDay)}
                  {spansMultipleDays && ` – ${formatDayHeading(endDay)}`}
                </span>
                <span className="font-mono text-sm text-zinc-900">
                  {formatTime(booking.starts_at)}–
                  {formatTime(booking.ends_at)}
                </span>
                <span className="text-sm text-zinc-600">
                  {memberName(booking.member_id)}
                  {booking.note ? ` · ${booking.note}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      );
  }

  const tabs: { view: ReportView; label: string; href: string }[] = [
    { view: "all", label: "All future bookings", href: `/${groupSlug}/reports` },
    {
      view: "mine",
      label: "My future bookings",
      href: `/${groupSlug}/reports?view=mine`,
    },
    {
      view: "distribution",
      label: "Bookings per member",
      href: `/${groupSlug}/reports?view=distribution`,
    },
  ];

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.view}
            href={tab.href}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              activeView === tab.view
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 text-zinc-600"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {content}
    </main>
  );
}
