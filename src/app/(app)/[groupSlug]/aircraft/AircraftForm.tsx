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
}: {
  groupId: string;
  groupSlug: string;
  initial: AircraftStatusFields;
}) {
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

      {STATUS_FIELDS.map((field) => (
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
            className={inputClass}
          />
        </label>
      ))}

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
