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

export default async function GroupDashboardPage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const [{ data: members }, { data: nextBookings }] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, display_name")
      .eq("group_id", group.id)
      .order("created_at")
      .returns<MemberRow[]>(),
    supabase
      .from("bookings")
      .select("id, member_id, starts_at, ends_at, note")
      .eq("group_id", group.id)
      .eq("status", "confirmed")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(1)
      .returns<BookingRow[]>(),
  ]);

  const memberList = members ?? [];
  const memberIndex = new Map(memberList.map((m, i) => [m.user_id, i]));
  const memberName = (userId: string) =>
    memberList.find((m) => m.user_id === userId)?.display_name ?? "Member";

  const nextBooking = nextBookings?.[0];

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h1 className="font-mono text-sm tracking-wide text-zinc-500 uppercase">
          {group.aircraft_registration}
        </h1>
        <p className="mt-1 text-lg font-semibold text-zinc-900">
          {group.aircraft_type ?? group.name}
        </p>
        {group.home_base && (
          <p className="text-sm text-zinc-500">Based at {group.home_base}</p>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-medium text-zinc-500">Next up</h2>
        {nextBooking ? (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                memberColor(memberIndex.get(nextBooking.member_id) ?? 0).dot
              }`}
            />
            <p className="text-sm text-zinc-900">
              {memberName(nextBooking.member_id)} ·{" "}
              {formatDayHeading(new Date(nextBooking.starts_at))},{" "}
              {formatTime(nextBooking.starts_at)}–
              {formatTime(nextBooking.ends_at)}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No upcoming bookings.</p>
        )}
      </section>

      <Link
        href={`/${groupSlug}/calendar`}
        className="rounded-lg border border-dashed border-zinc-300 px-4 py-4 text-center text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"
      >
        Open booking calendar →
      </Link>
    </main>
  );
}
