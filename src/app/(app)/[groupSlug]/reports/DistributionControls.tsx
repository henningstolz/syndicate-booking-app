import Link from "next/link";
import type { Metric } from "./distribution";

function pillClass(active: boolean) {
  return `rounded-full px-3 py-1 text-xs ${
    active
      ? "bg-zinc-200 font-medium text-zinc-900"
      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
  }`;
}

export function DistributionControls({
  groupSlug,
  metric,
  year,
  years,
}: {
  groupSlug: string;
  metric: Metric;
  // null = all time
  year: number | null;
  years: number[];
}) {
  const href = (nextMetric: Metric, nextYear: number | null) =>
    `/${groupSlug}/reports?view=distribution&metric=${nextMetric}&year=${nextYear ?? "all"}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-xs text-zinc-500">Measure</span>
        <Link href={href("bookings", year)} className={pillClass(metric === "bookings")}>
          Bookings
        </Link>
        <Link href={href("days", year)} className={pillClass(metric === "days")}>
          Days booked
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-xs text-zinc-500">Period</span>
        {years.map((y) => (
          <Link key={y} href={href(metric, y)} className={pillClass(year === y)}>
            {y}
          </Link>
        ))}
        <Link href={href(metric, null)} className={pillClass(year === null)}>
          All time
        </Link>
      </div>
    </div>
  );
}
