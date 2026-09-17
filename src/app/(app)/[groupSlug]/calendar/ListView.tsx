import type { User } from "@supabase/supabase-js";
import { londonDateKey, formatDayHeading, formatTime } from "@/lib/datetime";
import { memberColor } from "@/lib/member-colors";
import { BookingForm } from "./BookingForm";
import { cancelBooking } from "./actions";

type BookingRow = {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

export function ListView({
  groupSlug,
  groupId,
  days,
  bookingsByDay,
  memberIndex,
  memberName,
  user,
  myRole,
}: {
  groupSlug: string;
  groupId: string;
  days: Date[];
  bookingsByDay: Map<string, BookingRow[]>;
  memberIndex: Map<string, number>;
  memberName: (userId: string) => string;
  user: User | null;
  myRole: string | undefined;
}) {
  return (
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
              groupId={groupId}
              groupSlug={groupSlug}
              defaultDate={key}
            />
          </section>
        );
      })}
    </div>
  );
}
