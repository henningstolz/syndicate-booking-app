import Link from "next/link";
import { memberColor } from "@/lib/member-colors";

type BookingRow = {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Calendar weekday of a date is a plain calendar fact, independent of
// timezone, so plain UTC-based Date math is safe here purely as a
// day-of-week calculator — no real-world instant is involved.
function mondayFirstWeekday(year: number, monthIndex: number) {
  const sundayFirst = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export function MonthGrid({
  groupSlug,
  year,
  monthIndex,
  bookingsByDay,
  memberIndex,
}: {
  groupSlug: string;
  year: number;
  monthIndex: number;
  bookingsByDay: Map<string, BookingRow[]>;
  memberIndex: Map<string, number>;
}) {
  const totalDays = daysInMonth(year, monthIndex);
  const leadingBlanks = mondayFirstWeekday(year, monthIndex);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));

  const prevMonthIndex = monthIndex - 1;
  const prevYear = year + Math.floor(prevMonthIndex / 12);
  const prevParam = `${prevYear}-${pad(((prevMonthIndex % 12) + 12) % 12 + 1)}`;

  const nextMonthIndex = monthIndex + 1;
  const nextYear = year + Math.floor(nextMonthIndex / 12);
  const nextParam = `${nextYear}-${pad((nextMonthIndex % 12) + 1)}`;

  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link
          href={`/${groupSlug}/calendar?view=month&month=${prevParam}`}
          className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
        >
          ← Prev
        </Link>
        <h2 className="text-sm font-medium text-zinc-900">{monthLabel}</h2>
        <Link
          href={`/${groupSlug}/calendar?view=month&month=${nextParam}`}
          className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
        >
          Next →
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] tracking-wide text-zinc-400 uppercase">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`blank-${i}`} />;
          }
          const dateKey = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
          const dayBookings = bookingsByDay.get(dateKey) ?? [];

          return (
            <div
              key={dateKey}
              className="flex min-h-16 flex-col gap-1 rounded-md border border-zinc-200 bg-white p-1"
            >
              <span className="font-mono text-xs text-zinc-500">{day}</span>
              <div className="flex flex-wrap gap-0.5">
                {dayBookings.map((booking) => (
                  <span
                    key={booking.id}
                    className={`h-1.5 w-1.5 rounded-full ${memberColor(memberIndex.get(booking.member_id) ?? 0).dot}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
