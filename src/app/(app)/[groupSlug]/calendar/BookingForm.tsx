"use client";

import { useActionState, useEffect, useState } from "react";
import { createBooking, type BookingActionState } from "./actions";

const initialState: BookingActionState = {};

export function BookingForm({
  groupId,
  groupSlug,
  defaultDate,
}: {
  groupId: string;
  groupSlug: string;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createBooking, initialState);

  useEffect(() => {
    if (state.success) {
      setOpen(false);
    }
  }, [state.success]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-zinc-300 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
      >
        + Book
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupSlug" value={groupSlug} />

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-600">
          Starts
          <input
            type="datetime-local"
            name="startsAt"
            required
            defaultValue={`${defaultDate}T09:00`}
            className="rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-sm text-zinc-900"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-600">
          Ends
          <input
            type="datetime-local"
            name="endsAt"
            required
            defaultValue={`${defaultDate}T11:00`}
            className="rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-sm text-zinc-900"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Note (optional)
        <input
          type="text"
          name="note"
          placeholder="Local flight, PPL currency…"
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
        />
      </label>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Booking…" : "Confirm booking"}
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
