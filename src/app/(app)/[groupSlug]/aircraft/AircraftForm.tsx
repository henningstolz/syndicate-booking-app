"use client";

import { useActionState, useState } from "react";
import { updateAircraftStatus, type StatusActionState } from "./actions";
import { STATUS_FIELDS, type AircraftStatusFields } from "@/lib/aircraft-status";

const initialState: StatusActionState = {};

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";

export function AircraftForm({
  groupId,
  groupSlug,
  initial,
  hours,
}: {
  groupId: string;
  groupSlug: string;
  initial: AircraftStatusFields;
  hours: { total: number | null; checkAt: number | null };
}) {
  // Once the total and the check limit are known, the hours left to the next
  // check are worked out from the flight log, not typed in.
  const hoursCalculated = hours.total !== null && hours.checkAt !== null;
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    updateAircraftStatus,
    initialState,
  );

  // Close the form once a save succeeds, without the extra render an
  // effect would cost — same render-phase pattern used in BookingForm.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success && open) {
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-full border border-dashed border-zinc-300 px-4 py-1.5 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
      >
        Edit
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-zinc-50 p-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupSlug" value={groupSlug} />

      {STATUS_FIELDS.map((field) => {
        const calculated = hoursCalculated && field.column === "hours_to_next_check";
        return (
          <label
            key={field.column}
            className="flex flex-col gap-1 text-xs text-zinc-600"
          >
            {field.label}
            <input
              type={field.kind === "date" ? "date" : "number"}
              step={field.kind === "hours" ? "0.1" : undefined}
              name={field.column}
              defaultValue={initial[field.column] ?? ""}
              disabled={calculated}
              className={`${inputClass} disabled:bg-zinc-100 disabled:text-zinc-500`}
            />
            {calculated && (
              <span className="text-zinc-500">
                Calculated from the airframe hours and the tech log.
              </span>
            )}
          </label>
        );
      })}

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Airframe total hours (right now)
        <input
          type="number"
          step="0.1"
          min="0"
          name="airframeTotalHours"
          defaultValue={hours.total ?? ""}
          className={inputClass}
        />
        <input type="hidden" name="airframeTotalOriginal" value={hours.total ?? ""} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Next check at (airframe hours)
        <input
          type="number"
          step="0.1"
          min="0"
          name="nextCheckAtHours"
          defaultValue={hours.checkAt ?? ""}
          className={inputClass}
        />
        <input type="hidden" name="nextCheckAtOriginal" value={hours.checkAt ?? ""} />
        <span className="text-zinc-500">
          With both filled in, every flight in the tech log updates the hours left
          to the next check.
        </span>
      </label>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-4 py-1.5 text-xs font-medium text-zinc-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
