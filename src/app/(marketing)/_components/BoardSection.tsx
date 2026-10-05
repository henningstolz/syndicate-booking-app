import { Eyebrow } from "./Eyebrow";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];

// Illustrative sample data, not real bookings. Rows 2..9 are the hours
// (row 1 is the day header), columns 2..6 are Mon..Fri.
const BOOKINGS = [
  { column: 3, from: 3, to: 6, label: "09–12", background: "#e4edf0", color: "#1f5673" },
  { column: 4, from: 7, to: 9, label: "13–15", background: "#ebe5ed", color: "#5a3f66" },
  { column: 5, from: 6, to: 9, label: "12–15", background: "#e7efe6", color: "#2f5e43" },
  { column: 6, from: 3, to: 5, label: "09–11", background: "#f5e9d9", color: "#8a5316" },
];

export function BoardSection() {
  return (
    <section className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-14 px-6 pt-[88px] pb-24">
      <div className="min-w-0 flex-[1_1_300px]">
        <Eyebrow>THE BOARD</Eyebrow>
        <h2 className="mb-[18px] text-[clamp(30px,3.6vw,42px)] leading-[1.1] font-bold tracking-[-0.015em]">
          One board for the whole week.
        </h2>
        <p className="max-w-[420px] text-bt-muted">
          Every booking and every open squawk, visible to everyone in the
          group, so nobody has to ask who has the aircraft.
        </p>
      </div>

      <figure
        role="img"
        aria-label="Illustration of a booking board for G-ABCD: four bookings between Tuesday and Friday and one open squawk about an intermittent transponder fault."
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

          <div className="grid grid-cols-[44px_repeat(5,minmax(0,1fr))] grid-rows-[repeat(9,34px)] font-mono text-[11px] text-bt-muted">
            <div style={{ gridColumn: 1, gridRow: 1 }} className="border-b border-bt-grid" />
            {DAYS.map((day, i) => (
              <div
                key={day}
                style={{ gridColumn: i + 2, gridRow: 1 }}
                className="border-b border-l border-bt-grid pt-[9px] pl-2"
              >
                {day}
              </div>
            ))}

            {HOURS.map((hour, i) => (
              <div
                key={hour}
                style={{ gridColumn: 1, gridRow: i + 2 }}
                className="border-b border-bt-grid pt-1 pr-2 text-right"
              >
                {hour}
              </div>
            ))}

            {/* Grid lines under the bookings. */}
            <div
              style={{
                gridColumn: "2 / 7",
                gridRow: "2 / 10",
                backgroundImage:
                  "linear-gradient(to right, #d9dbd2 1px, transparent 1px), linear-gradient(to bottom, #d9dbd2 1px, transparent 1px)",
                backgroundSize: "20% 100%, 100% 34px",
              }}
              className="pointer-events-none"
            />

            {BOOKINGS.map((booking) => (
              <div
                key={`${booking.column}-${booking.from}`}
                style={{
                  gridColumn: booking.column,
                  gridRow: `${booking.from} / ${booking.to}`,
                  background: booking.background,
                  color: booking.color,
                }}
                className="m-0.5 min-w-0 p-1 font-medium sm:px-[7px] sm:py-1.5"
              >
                {booking.label}
                <div className="text-[10.5px] font-normal">booked</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-bt-ink bg-bt-paper px-4 py-3">
            <p className="border border-bt-amber-line px-[7px] py-0.5 font-mono text-[11px] text-bt-amber">
              SQUAWK
            </p>
            <p className="flex-[1_1_180px] text-sm">Transponder: intermittent fault</p>
            <p className="font-mono text-[11px] text-bt-muted">open</p>
          </div>
        </div>
      </figure>
    </section>
  );
}
