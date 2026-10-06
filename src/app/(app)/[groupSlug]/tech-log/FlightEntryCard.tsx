import { LONDON_TZ, formatTime } from "@/lib/datetime";
import { formatDeci, formatDuration } from "@/lib/flight-times";
import { voidFlightEntry } from "./flight-actions";

export type FlightRow = {
  id: string;
  from_place: string;
  to_place: string;
  flight_category: string;
  captain_id: string | null;
  captain_name: string;
  created_by: string;
  fuel_left_usg: number;
  fuel_right_usg: number;
  oil_qt: number;
  brakes_off: string;
  airborne: string;
  landed: string;
  brakes_on: string;
  block_minutes: number;
  flight_minutes: number;
  block_deci: number;
  flight_deci: number;
  defects: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

// One flight in the log. `totals` is the airframe total (and hours to the next
// check) after this flight, when the totals are set up. `loggedBy` is set when
// someone other than the captain typed the entry in.
export function FlightEntryCard({
  entry,
  groupSlug,
  isAdmin,
  totals,
  borderClass,
  loggedBy,
}: {
  entry: FlightRow;
  groupSlug: string;
  isAdmin: boolean;
  totals?: { total: number; toCheck: number | null };
  borderClass: string;
  loggedBy: string | null;
}) {
  const voided = Boolean(entry.voided_at);
  return (
    <article
      className={`flex flex-col gap-2 rounded-lg border-l-4 bg-white px-3 py-2 shadow-sm ${borderClass} ${voided ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-sm font-medium text-zinc-900 ${voided ? "line-through" : ""}`}
          >
            {entry.from_place} → {entry.to_place}{" "}
            <span className="rounded border border-zinc-300 px-1 font-mono text-xs font-normal text-zinc-600">
              {entry.flight_category}
            </span>
          </p>
          <p className="text-xs text-zinc-500">
            {dayFormat.format(new Date(entry.brakes_off))} · {entry.captain_name}
            {loggedBy && ` · logged by ${loggedBy}`}
          </p>
        </div>
        <p
          className={`shrink-0 font-mono text-sm text-zinc-900 ${voided ? "line-through" : ""}`}
        >
          {formatDeci(entry.flight_deci)} h
        </p>
      </div>

      <p className="font-mono text-xs text-zinc-600">
        Off {formatTime(entry.brakes_off)} · Up {formatTime(entry.airborne)} · Down{" "}
        {formatTime(entry.landed)} · On {formatTime(entry.brakes_on)}
      </p>
      <p className="font-mono text-xs text-zinc-600">
        Flight {formatDuration(entry.flight_minutes)} ({formatDeci(entry.flight_deci)}) ·
        Block {formatDuration(entry.block_minutes)} ({formatDeci(entry.block_deci)})
      </p>
      <p className="font-mono text-xs text-zinc-600">
        Fuel L {Number(entry.fuel_left_usg).toFixed(1)} / R{" "}
        {Number(entry.fuel_right_usg).toFixed(1)} (
        {(Number(entry.fuel_left_usg) + Number(entry.fuel_right_usg)).toFixed(1)} USG) ·
        Oil {Number(entry.oil_qt)} qt
      </p>

      {entry.defects && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm whitespace-pre-wrap text-amber-900">
          <span className="font-medium">Defect: </span>
          {entry.defects}
        </p>
      )}

      {totals && (
        <p className="font-mono text-xs text-zinc-500">
          Airframe {totals.total.toFixed(1)} h
          {totals.toCheck !== null && ` · ${totals.toCheck.toFixed(1)} h to check`}
        </p>
      )}

      {voided && <p className="text-xs text-zinc-600">Voided: {entry.void_reason}</p>}

      {isAdmin && !voided && (
        <details className="text-xs text-zinc-600">
          <summary className="w-fit text-zinc-500 underline underline-offset-4">
            Void this entry
          </summary>
          <form action={voidFlightEntry} className="mt-2 flex max-w-sm flex-col gap-2">
            <input type="hidden" name="groupSlug" value={groupSlug} />
            <input type="hidden" name="entryId" value={entry.id} />
            <p>
              A voided entry stays in the log but stops counting towards the
              hours. Enter it again correctly afterwards.
            </p>
            <input
              type="text"
              name="reason"
              required
              minLength={3}
              maxLength={300}
              placeholder="Reason, e.g. wrong day"
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900"
            />
            <button
              type="submit"
              className="w-fit rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Void entry
            </button>
          </form>
        </details>
      )}
    </article>
  );
}
