"use client";

import { useActionState, useState } from "react";
import { createBooking, type BookingActionState } from "./actions";
import {
  FULL_DAY_START,
  FULL_DAY_END,
  HALF_DAY_SPLIT,
} from "@/lib/booking-durations";

const initialState: BookingActionState = {};

type Mode = "custom" | "half-am" | "half-pm" | "full-day" | "multi-day";

const MODE_LABELS: Record<Mode, string> = {
  "full-day": "Full day",
  "multi-day": "Multiple days",
  "half-am": "Half day (morning)",
  "half-pm": "Half day (afternoon)",
  custom: "Custom times",
};

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";

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
  const [mode, setMode] = useState<Mode>("full-day");
  const [state, action, pending] = useActionState(createBooking, initialState);

  // Close the form when a submission just succeeded, without the extra
  // render an effect would cost — React's documented pattern for
  // reacting to a value change during render itself.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success && open) {
      setOpen(false);
      setMode("full-day");
    }
  }

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
      <input type="hidden" name="mode" value={mode} />

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Duration
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className={inputClass}
        >
          {(Object.entries(MODE_LABELS) as [Mode, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </label>

      {mode === "custom" && (
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-600">
            Starts
            <input
              type="datetime-local"
              name="startsAt"
              required
              defaultValue={`${defaultDate}T09:00`}
              className={`font-mono ${inputClass}`}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-600">
            Ends
            <input
              type="datetime-local"
              name="endsAt"
              required
              defaultValue={`${defaultDate}T11:00`}
              className={`font-mono ${inputClass}`}
            />
          </label>
        </div>
      )}

      {(mode === "half-am" || mode === "half-pm" || mode === "full-day") && (
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Date
          <input
            type="date"
            name="date"
            required
            defaultValue={defaultDate}
            className={`font-mono ${inputClass}`}
          />
        </label>
      )}

      {mode === "multi-day" && (
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-600">
            From
            <input
              type="date"
              name="startDate"
              required
              defaultValue={defaultDate}
              className={`font-mono ${inputClass}`}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-600">
            To
            <input
              type="date"
              name="endDate"
              required
              defaultValue={defaultDate}
              className={`font-mono ${inputClass}`}
            />
          </label>
        </div>
      )}

      {(mode === "half-am" || mode === "half-pm" || mode === "full-day" || mode === "multi-day") && (
        <p className="text-xs text-zinc-500">
          {mode === "half-am" && `Books ${FULL_DAY_START}–${HALF_DAY_SPLIT}.`}
          {mode === "half-pm" && `Books ${HALF_DAY_SPLIT}–${FULL_DAY_END}.`}
          {mode === "full-day" && `Books ${FULL_DAY_START}–${FULL_DAY_END}.`}
          {mode === "multi-day" &&
            `Books ${FULL_DAY_START} on the first day to ${FULL_DAY_END} on the last.`}
        </p>
      )}

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Note (optional)
        <input
          type="text"
          name="note"
          placeholder="Local flight, PPL currency…"
          className={inputClass}
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
