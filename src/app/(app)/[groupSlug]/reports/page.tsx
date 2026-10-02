import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import {
  londonDateKey,
  londonWallTimeToUtc,
  formatDayHeading,
  formatTime,
} from "@/lib/datetime";
import { DistributionChart, type Slice } from "./DistributionChart";

type MemberRow = { user_id: string; display_name: string | null };

type BookingRow = {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

type ReportView = "all" | "mine" | "distribution";

// More segments than this stop being readable as a ring, so the tail
// is folded into a single "Other" bucket.
const MAX_SLICES = 6;

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { groupSlug } = await params;
  const { view } = await searchParams;
  const activeView: ReportView =
    view === "mine" || view === "distribution" ? view : "all";

  const supabase = await createClient();
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const year = Number(londonDateKey(new Date()).slice(0, 4));

  const membersQuery = supabase
    .from("group_members")
    .select("user_id, display_name")
    .eq("group_id", group.id)
    .order("created_at")
    .returns<MemberRow[]>();

  let content: React.ReactNode;
  let memberList: MemberRow[];

  if (activeView === "distribution") {
    const [{ data: members }, { data: rows }] = await Promise.all([
      membersQuery,
      supabase
        .from("bookings")
        .select("member_id")
        .eq("group_id", group.id)
        .eq("status", "confirmed")
        .gte("starts_at", londonWallTimeToUtc(`${year}-01-01`, "00:00").toISOString())
        .lt("starts_at", londonWallTimeToUtc(`${year + 1}-01-01`, "00:00").toISOString())
        .returns<{ member_id: string }[]>(),
    ]);
    memberList = members ?? [];

    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      counts.set(row.member_id, (counts.get(row.member_id) ?? 0) + 1);
    }

    const byMember: Slice[] = [...counts.entries()]
      .map(([memberId, count]) => {
        const index = memberList.findIndex((m) => m.user_id === memberId);
        return {
          key: memberId,
          label:
            (index >= 0 ? memberList[index].display_name : null) ?? "Member",
          count,
          colorIndex: index >= 0 ? index : 0,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    let slices = byMember;
    if (byMember.length > MAX_SLICES) {
      const rest = byMember.slice(MAX_SLICES - 1);
      slices = [
        ...byMember.slice(0, MAX_SLICES - 1),
        {
          key: "other",
          label: `Other (${rest.length} members)`,
          count: rest.reduce((sum, s) => sum + s.count, 0),
          colorIndex: null,
        },
      ];
    }

    content = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500">
          Confirmed bookings starting in {year}, past and upcoming. A
          multi-day booking counts once.
        </p>
        <DistributionChart slices={slices} year={year} />
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
      label: `Bookings per member ${year}`,
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
