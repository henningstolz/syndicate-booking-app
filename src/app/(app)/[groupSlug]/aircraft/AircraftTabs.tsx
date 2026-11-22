import Link from "next/link";

// The two pages of Aircraft: the status of the aircraft (dates, hours, equipment) and when it is unavailable.
export function AircraftTabs({ groupSlug, active }: { groupSlug: string; active: "status" | "availability" }) {
  const tabClass = (on: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium ${
      on ? "bg-zinc-900 text-white" : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
    }`;
  return (
    <nav aria-label="Aircraft sections" className="flex gap-2">
      <Link href={`/${groupSlug}/aircraft`} className={tabClass(active === "status")}>
        Status
      </Link>
      <Link href={`/${groupSlug}/aircraft/availability`} className={tabClass(active === "availability")}>
        Availability
      </Link>
    </nav>
  );
}
