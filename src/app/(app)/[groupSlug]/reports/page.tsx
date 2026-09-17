import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { formatDayHeading, formatTime } from "@/lib/datetime";

type MemberRow = { user_id: string; display_name: string | null };

type BookingRow = {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { groupSlug } = await params;
  const { view } = await searchParams;
  const mineOnly = view === "mine";

  const supabase = await createClient();
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let bookingsQuery = supabase
    .from("bookings")
    .select("id, member_id, starts_at, ends_at, note")
    .eq("group_id", group.id)
    .eq("status", "confirmed")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at");

  if (mineOnly && user) {
    bookingsQuery = bookingsQuery.eq("member_id", user.id);
  }

  const [{ data: members }, { data: bookings }] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, display_name")
      .eq("group_id", group.id)
      .order("created_at")
      .returns<MemberRow[]>(),
    bookingsQuery.returns<BookingRow[]>(),
  ]);

  const memberList = members ?? [];
  const memberIndex = new Map(memberList.map((m, i) => [m.user_id, i]));
  const memberName = (userId: string) =>
    memberList.find((m) => m.user_id === userId)?.display_name ?? "Member";

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex gap-2">
        <Link
          href={`/${groupSlug}/reports`}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            !mineOnly
              ? "bg-zinc-900 text-white"
              : "border border-zinc-300 text-zinc-600"
          }`}
        >
          All future bookings
        </Link>
        <Link
          href={`/${groupSlug}/reports?view=mine`}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            mineOnly
              ? "bg-zinc-900 text-white"
              : "border border-zinc-300 text-zinc-600"
          }`}
        >
          My future bookings
        </Link>
      </div>

      {!bookings || bookings.length === 0 ? (
        <p className="text-sm text-zinc-500">No upcoming bookings.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {bookings.map((booking) => {
            const colorIndex = memberIndex.get(booking.member_id) ?? 0;
            return (
              <div
                key={booking.id}
                className={`flex flex-col gap-0.5 rounded-lg border-l-4 bg-white px-3 py-2 shadow-sm ${memberColor(colorIndex).border}`}
              >
                <span className="font-mono text-xs text-zinc-500">
                  {formatDayHeading(new Date(booking.starts_at))}
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
      )}
    </main>
  );
}
