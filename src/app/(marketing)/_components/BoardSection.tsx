import Link from "next/link";
import { MonthGrid } from "@/app/(app)/[groupSlug]/calendar/MonthGrid";
import { londonDateKey } from "@/lib/datetime";
import { memberColor } from "@/lib/member-colors";
import { Eyebrow } from "./Eyebrow";

// Made-up people and bookings for the picture. The calendar below is the app's own
// month view (the same component the signed-in calendar uses), so it always looks
// like the real thing, and it shows the current month with today marked. The days
// are the same in every month (all within 1 to 28), so the picture always looks full.
const PEOPLE = ["Alex", "Sam", "Jordan", "Taylor"];
const BOOKING_DAYS: [number, number][] = [
  [2, 0], [3, 2], [5, 1], [6, 1], [8, 3], [10, 0], [11, 2], [13, 1], [14, 1],
  [16, 3], [17, 0], [19, 2], [20, 2], [22, 1], [24, 0], [25, 3], [27, 2], [28, 1],
];

export function BoardSection() {
  const todayKey = londonDateKey(new Date());
  const [year, month] = todayKey.split("-").map(Number);
  const monthIndex = month - 1;
  const pad = (n: number) => String(n).padStart(2, "0");

  const bookingsByDay = new Map<
    string,
    { id: string; member_id: string; starts_at: string; ends_at: string; note: string | null }[]
  >();
  for (const [day, person] of BOOKING_DAYS) {
    const key = `${year}-${pad(month)}-${pad(day)}`;
    bookingsByDay.set(key, [
      { id: `sample-${day}`, member_id: PEOPLE[person], starts_at: `${key}T09:00:00Z`, ends_at: `${key}T12:00:00Z`, note: null },
    ]);
  }
  const memberIndex = new Map(PEOPLE.map((name, i) => [name, i]));

  return (
    <section className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-14 px-6 pt-[88px] pb-24">
      <div className="min-w-0 flex-[1_1_300px]">
        <Eyebrow>THE BOARD</Eyebrow>
        <h2 className="mb-[18px] text-[clamp(30px,3.6vw,42px)] leading-[1.1] font-bold tracking-[-0.015em]">
          One board for the whole month.
        </h2>
        <p className="max-w-[420px] text-bt-muted">
          Every booking and every open entry in the tech log, visible to
          everyone in the group, so nobody has to ask who has the aircraft.
        </p>
        <p className="mt-5">
          <Link
            href="/demo/calendar"
            className="text-[15px] text-bt-ink underline underline-offset-4 hover:text-bt-blue"
          >
            Open the calendar in the demo
          </Link>
        </p>
      </div>

      <figure
        aria-label="The calendar for G-ABCD: a month with the days other people have booked, each in the colour of the person who booked it, and today marked."
        className="min-w-0 flex-[1_1_440px]"
      >
        <div className="border border-bt-ink bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-bt-ink px-4 py-3.5">
            <div>
              <p className="font-mono text-xl font-semibold">G-ABCD</p>
              <p className="text-[13px] text-bt-muted">Piper PA28R Arrow</p>
            </div>
            <p className="border border-bt-green-line px-[9px] py-1 font-mono text-xs text-bt-green">
              available now
            </p>
          </div>

          <div className="flex flex-col gap-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {PEOPLE.map((name, i) => (
                  <li key={name} className="flex items-center gap-1.5 text-[13px] text-zinc-600">
                    <span className={`h-2.5 w-2.5 rounded-full ${memberColor(i).dot}`} />
                    {name}
                  </li>
                ))}
              </ul>
              <p className="flex gap-1.5 text-xs font-medium" aria-hidden="true">
                <span className="rounded-full bg-zinc-900 px-3 py-1 text-white">Month</span>
                <span className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-600">List</span>
              </p>
            </div>
            <MonthGrid
              groupSlug="demo"
              year={year}
              monthIndex={monthIndex}
              todayKey={todayKey}
              bookingsByDay={bookingsByDay}
              memberIndex={memberIndex}
              memberName={(id) => id}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-bt-ink bg-bt-paper px-4 py-3">
            <p className="border border-bt-amber-line px-[7px] py-0.5 font-mono text-[11px] text-bt-amber">
              TECH LOG
            </p>
            <p className="flex-[1_1_180px] text-sm">Transponder: intermittent fault</p>
            <p className="font-mono text-[11px] text-bt-muted">open</p>
          </div>
        </div>
      </figure>
    </section>
  );
}
