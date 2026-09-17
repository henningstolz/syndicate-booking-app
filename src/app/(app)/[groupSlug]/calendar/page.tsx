import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { londonDateKey, londonWallTimeToUtc } from "@/lib/datetime";
import { ListView } from "./ListView";
import { MonthGrid } from "./MonthGrid";

const DAYS_AHEAD = 14;

type MemberRow = {
  user_id: string;
  display_name: string | null;
  role: string;
};

type BookingRow = {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function currentLondonYearMonth() {
  const [year, month] = londonDateKey(new Date()).split("-").map(Number);
  return { year, monthIndex: month - 1 };
}

function parseMonthParam(month: string | undefined) {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [year, m] = month.split("-").map(Number);
    return { year, monthIndex: m - 1 };
  }
  return currentLondonYearMonth();
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ view?: string; month?: string; start?: string }>;
}) {
  const { groupSlug } = await params;
  const { view, month, start } = await searchParams;
  const isMonthView = view === "month";
  const validStart = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;

  const supabase = await createClient();
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = new Date();
  const { year, monthIndex } = parseMonthParam(month);
  // Anchors the List view's rolling window — "today" by default, or a
  // specific date when arriving from a Month-view day click, so List
  // can reach dates further out than the default 14-day-from-today
  // window (e.g. booking something next month).
  const listAnchor = validStart
    ? londonWallTimeToUtc(validStart, "00:00")
    : today;

  let rangeStart: Date;
  let rangeEnd: Date;
  if (isMonthView) {
    rangeStart = londonWallTimeToUtc(
      `${year}-${pad(monthIndex + 1)}-01`,
      "00:00",
    );
    const nextMonthIndex = monthIndex + 1;
    const nextYear = year + Math.floor(nextMonthIndex / 12);
    rangeEnd = londonWallTimeToUtc(
      `${nextYear}-${pad((nextMonthIndex % 12) + 1)}-01`,
      "00:00",
    );
  } else {
    rangeStart = listAnchor;
    rangeEnd = new Date(listAnchor.getTime() + DAYS_AHEAD * 86_400_000);
  }

  const [{ data: members }, { data: bookings }] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, display_name, role")
      .eq("group_id", group.id)
      .order("created_at")
      .returns<MemberRow[]>(),
    supabase
      .from("bookings")
      .select("id, member_id, starts_at, ends_at, note")
      .eq("group_id", group.id)
      .eq("status", "confirmed")
      .gte("ends_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .order("starts_at")
      .returns<BookingRow[]>(),
  ]);

  const memberList = members ?? [];
  const memberIndex = new Map(memberList.map((m, i) => [m.user_id, i]));
  const memberName = (userId: string) =>
    memberList.find((m) => m.user_id === userId)?.display_name ?? "Member";
  const myRole = memberList.find((m) => m.user_id === user?.id)?.role;

  const bookingsByDay = new Map<string, BookingRow[]>();
  for (const booking of bookings ?? []) {
    const key = londonDateKey(new Date(booking.starts_at));
    const list = bookingsByDay.get(key) ?? [];
    list.push(booking);
    bookingsByDay.set(key, list);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <section className="flex flex-wrap gap-x-4 gap-y-2">
          {memberList.map((member, i) => (
            <div
              key={member.user_id}
              className="flex items-center gap-1.5 text-sm text-zinc-600"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${memberColor(i).dot}`}
              />
              {member.display_name ?? "Member"}
            </div>
          ))}
        </section>

        <div className="flex gap-2">
          <Link
            href={`/${groupSlug}/calendar`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !isMonthView
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 text-zinc-600"
            }`}
          >
            List
          </Link>
          <Link
            href={`/${groupSlug}/calendar?view=month`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              isMonthView
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 text-zinc-600"
            }`}
          >
            Month
          </Link>
        </div>
      </div>

      {isMonthView ? (
        <MonthGrid
          groupSlug={groupSlug}
          year={year}
          monthIndex={monthIndex}
          bookingsByDay={bookingsByDay}
          memberIndex={memberIndex}
        />
      ) : (
        <ListView
          groupSlug={groupSlug}
          groupId={group.id}
          days={Array.from(
            { length: DAYS_AHEAD },
            (_, i) => new Date(listAnchor.getTime() + i * 86_400_000),
          )}
          bookingsByDay={bookingsByDay}
          memberIndex={memberIndex}
          memberName={memberName}
          user={user}
          myRole={myRole}
        />
      )}
    </main>
  );
}
