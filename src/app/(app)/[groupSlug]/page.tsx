import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { BookingForm } from "./BookingForm";
import { cancelBooking } from "./actions";

const DAYS_AHEAD = 14;
const LONDON_TZ = "Europe/London";

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

// "en-CA" conveniently formats as YYYY-MM-DD, used both as the map key
// for grouping bookings by day and as the <input type="date"> default.
function londonDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON_TZ }).format(date);
}

function formatDayHeading(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = new Date();
  const windowEnd = new Date(today.getTime() + DAYS_AHEAD * 86_400_000);

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
      .gte("ends_at", today.toISOString())
      .lt("starts_at", windowEnd.toISOString())
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

  const days = Array.from(
    { length: DAYS_AHEAD },
    (_, i) => new Date(today.getTime() + i * 86_400_000),
  );

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6">
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

      <div className="flex flex-col gap-4">
        {days.map((day) => {
          const key = londonDateKey(day);
          const dayBookings = bookingsByDay.get(key) ?? [];

          return (
            <section key={key} className="flex flex-col gap-2">
              <h2 className="font-mono text-xs tracking-wide text-zinc-500 uppercase">
                {formatDayHeading(day)}
              </h2>

              {dayBookings.map((booking) => {
                const colorIndex = memberIndex.get(booking.member_id) ?? 0;
                const canCancel =
                  booking.member_id === user?.id || myRole === "admin";

                return (
                  <div
                    key={booking.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border-l-4 bg-white px-3 py-2 shadow-sm ${memberColor(colorIndex).border}`}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-sm text-zinc-900">
                        {formatTime(booking.starts_at)}–
                        {formatTime(booking.ends_at)}
                      </span>
                      <span className="text-sm text-zinc-600">
                        {memberName(booking.member_id)}
                        {booking.note ? ` · ${booking.note}` : ""}
                      </span>
                    </div>
                    {canCancel && (
                      <form action={cancelBooking}>
                        <input
                          type="hidden"
                          name="bookingId"
                          value={booking.id}
                        />
                        <input
                          type="hidden"
                          name="groupSlug"
                          value={groupSlug}
                        />
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 underline underline-offset-4 hover:text-red-600"
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}

              <BookingForm
                groupId={group.id}
                groupSlug={groupSlug}
                defaultDate={key}
              />
            </section>
          );
        })}
      </div>
    </main>
  );
}
