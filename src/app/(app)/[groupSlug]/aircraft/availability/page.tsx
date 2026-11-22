import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { londonDateKey } from "@/lib/datetime";
import { describePeriod, reasonLabel, splitPeriods, type DowntimePeriod } from "@/lib/downtime";
import { AircraftTabs } from "../AircraftTabs";
import { DowntimeForm } from "./DowntimeForm";
import { removeDowntime } from "./actions";

// When the aircraft is unavailable (maintenance, a defect, the annual, ...). Everyone sees the periods; group
// admins add and remove them. A period blocks new bookings, and adding one cancels the bookings in it (after
// the admin has confirmed the list) and emails the members affected.
export default async function AvailabilityPage({ params }: { params: Promise<{ groupSlug: string }> }) {
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
  const { data: membership } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", group.id)
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  const isAdmin = membership?.role === "admin";

  const { data: rows } = await supabase
    .from("aircraft_downtime")
    .select("id, starts_at, ends_at, reason, note")
    .eq("group_id", group.id)
    .is("removed_at", null)
    .order("starts_at")
    .returns<DowntimePeriod[]>();
  const now = new Date();
  const { current, upcoming, earlier } = splitPeriods(rows ?? [], now);

  const card = (period: DowntimePeriod, tone: string) => (
    <div key={period.id} className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{reasonLabel(period.reason)}</span>
        <span className="font-mono text-sm">{describePeriod(period.starts_at, period.ends_at)}</span>
        {period.note && <span className="text-sm opacity-80">{period.note}</span>}
      </div>
      {isAdmin && (
        <form action={removeDowntime}>
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="groupSlug" value={groupSlug} />
          <input type="hidden" name="id" value={period.id} />
          <button type="submit" className="text-xs underline underline-offset-4 hover:text-red-700">
            Remove
          </button>
        </form>
      )}
    </div>
  );

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-6">
      <AircraftTabs groupSlug={groupSlug} active="availability" />

      <p className="max-w-xl text-sm text-zinc-600">
        When {group.aircraft_registration} cannot be flown: maintenance, a defect, the annual. These periods show on the
        calendar for everyone and nobody can book the aircraft in them.
      </p>

      {current.length > 0 && (
        <section className="flex max-w-xl flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Unavailable now</h2>
          {current.map((period) => card(period, "border-red-300 bg-red-50 text-red-800"))}
        </section>
      )}

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Coming up</h2>
        {upcoming.length > 0 ? (
          upcoming.map((period) => card(period, "border-amber-300 bg-amber-50 text-amber-900"))
        ) : (
          <p className="text-sm text-zinc-500">
            {current.length > 0 ? "Nothing else planned." : "No unavailable periods planned. The aircraft can be booked on any day."}
          </p>
        )}
      </section>

      {isAdmin && <DowntimeForm groupId={group.id} groupSlug={groupSlug} todayKey={londonDateKey(now)} />}

      {isAdmin && (
        <p className="max-w-xl text-xs text-zinc-500">
          Removing a period makes the aircraft bookable again. Bookings that were cancelled because of it stay
          cancelled.
        </p>
      )}

      {earlier.length > 0 && (
        <details className="max-w-xl text-sm text-zinc-600">
          <summary className="cursor-pointer text-sm font-medium text-zinc-500">Earlier ({earlier.length})</summary>
          <div className="mt-2 flex flex-col gap-2">{earlier.slice(0, 20).map((period) => card(period, "border-zinc-200 bg-zinc-50 text-zinc-600"))}</div>
        </details>
      )}
    </main>
  );
}
