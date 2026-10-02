import { memberColor, OTHER_COLOR } from "@/lib/member-colors";

export type Slice = {
  key: string;
  label: string;
  count: number;
  // Index into the shared member palette; null = the folded "Other" bucket.
  colorIndex: number | null;
};

const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 62;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Surface-coloured gap between touching segments, so neighbours read as
// distinct without a border drawn around them.
const GAP = 2;

function formatPercent(fraction: number) {
  const pct = fraction * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export function DistributionChart({
  slices,
  year,
}: {
  slices: Slice[];
  year: number;
}) {
  const total = slices.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <p className="text-sm text-zinc-500">No bookings in {year} yet.</p>
    );
  }

  // A ring of one or two segments says less than the numbers do, so it
  // only appears once there's a spread worth showing.
  const showRing = slices.length >= 3;

  const arcs = slices.map((slice, i) => ({
    slice,
    fraction: slice.count / total,
    // Each segment starts where the previous ones end.
    start: slices.slice(0, i).reduce((sum, s) => sum + s.count, 0) / total,
  }));

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      {showRing && (
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-40 w-40 shrink-0"
          role="img"
          aria-label={`Bookings per member in ${year}: ${arcs
            .map(
              (a) => `${a.slice.label} ${a.slice.count} (${formatPercent(a.fraction)})`,
            )
            .join(", ")}`}
        >
          {arcs.map(({ slice, fraction, start }) => {
            const color =
              slice.colorIndex === null
                ? OTHER_COLOR
                : memberColor(slice.colorIndex);
            const length = Math.max(fraction * CIRCUMFERENCE - GAP, 0.01);
            return (
              <circle
                key={slice.key}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${length} ${CIRCUMFERENCE}`}
                strokeDashoffset={-start * CIRCUMFERENCE}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
                className={color.stroke}
              >
                {/* One string, not several JSX children — React expects a
                    single text node in <title> and mismatches on hydration
                    otherwise. */}
                <title>{`${slice.label}: ${slice.count} ${
                  slice.count === 1 ? "booking" : "bookings"
                } (${formatPercent(fraction)})`}</title>
              </circle>
            );
          })}
          <text
            x={CENTER}
            y={CENTER + 4}
            textAnchor="middle"
            className="fill-zinc-900 text-[28px] font-semibold"
          >
            {total}
          </text>
          <text
            x={CENTER}
            y={CENTER + 20}
            textAnchor="middle"
            className="fill-zinc-500 text-[10px]"
          >
            bookings in {year}
          </text>
        </svg>
      )}

      {/* Legend doubles as the table view: same order as the ring,
          clockwise from the top, with exact figures. */}
      <ul className="flex w-full flex-1 flex-col gap-2">
        {arcs.map(({ slice, fraction }) => {
          const color =
            slice.colorIndex === null
              ? OTHER_COLOR
              : memberColor(slice.colorIndex);
          return (
            <li
              key={slice.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${color.dot}`}
                />
                <span className="truncate text-sm text-zinc-900">
                  {slice.label}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="font-mono text-sm text-zinc-900">
                  {slice.count}
                </span>
                <span className="w-10 text-right font-mono text-xs text-zinc-500">
                  {formatPercent(fraction)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
