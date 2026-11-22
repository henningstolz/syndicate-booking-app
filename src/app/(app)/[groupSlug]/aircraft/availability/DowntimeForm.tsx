"use client";

import { useActionState, useState } from "react";
import { addDowntime, type DowntimeActionState } from "./actions";
import { DOWNTIME_REASONS, MAX_DOWNTIME_NOTE, describePeriod } from "@/lib/downtime";

const initialState: DowntimeActionState = {};

const labelClass = "flex flex-col gap-1 text-xs text-zinc-600";
const inputClass = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const FIELDS = ["startDate", "endDate", "startTime", "endTime", "reason", "note"] as const;

// "Mark the aircraft unavailable" for group admins. If bookings overlap the period it first lists them; nothing
// is cancelled or emailed until the admin confirms that list.
export function DowntimeForm({ groupId, groupSlug, todayKey }: { groupId: string; groupSlug: string; todayKey: string }) {
  const [state, action, pending] = useActionState(addDowntime, initialState);
  // "Back" hides the confirmation without changing anything.
  const [hidden, setHidden] = useState<DowntimeActionState | null>(null);
  // A fresh, empty form after a successful save.
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success) setFormKey((k) => k + 1);
  }

  const confirm = state.confirm && hidden !== state ? state.confirm : null;

  if (confirm) {
    const hasBookings = confirm.bookings.length > 0;
    return (
      <form action={action} className="flex max-w-xl flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="groupSlug" value={groupSlug} />
        {FIELDS.map((field) => (
          <input key={field} type="hidden" name={field} value={confirm.values[field] ?? ""} />
        ))}
        <input type="hidden" name="confirm" value="1" />
        <input type="hidden" name="confirmIds" value={confirm.bookings.map((b) => b.id).join(",")} />

        <h3 className="text-sm font-semibold text-red-800">
          {confirm.bookings.length === 1 ? "1 booking" : `${confirm.bookings.length} bookings`} would be cancelled
        </h3>
        <p className="text-sm text-red-900">
          Maintenance takes precedence over bookings. If you go on, these bookings are cancelled and each member
          affected gets an email. This cannot be undone.
        </p>
        <ul className="flex flex-col gap-1 text-sm text-zinc-900">
          {confirm.bookings.map((booking) => (
            <li key={booking.id} className="rounded-md bg-white px-3 py-1.5">
              <span className="font-medium">{booking.who}</span>: {describePeriod(booking.starts_at, booking.ends_at)}
              {booking.note ? <span className="text-zinc-500"> ({booking.note})</span> : null}
            </li>
          ))}
        </ul>
        {state.error && <p className="text-xs text-red-700">{state.error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || !hasBookings}
            className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : `Cancel ${confirm.bookings.length === 1 ? "this booking" : "these bookings"} and mark unavailable`}
          </button>
          <button
            type="button"
            onClick={() => setHidden(state)}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-zinc-600"
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <form key={formKey} action={action} className="flex max-w-xl flex-col gap-3 rounded-lg border border-zinc-300 bg-zinc-50 p-4">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupSlug" value={groupSlug} />
      <h3 className="text-sm font-medium text-zinc-700">Mark the aircraft unavailable</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          From (date)
          <input type="date" name="startDate" required min={todayKey} defaultValue={todayKey} className={inputClass} />
        </label>
        <label className={labelClass}>
          To (date, included)
          <input type="date" name="endDate" required min={todayKey} className={inputClass} />
        </label>
        <label className={labelClass}>
          From time (optional)
          <input type="time" name="startTime" className={inputClass} />
        </label>
        <label className={labelClass}>
          To time (optional)
          <input type="time" name="endTime" className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        UK time. With no times, whole days are blocked, from the start of the first day to the end of the last.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Reason
          <select name="reason" required defaultValue="maintenance" className={inputClass}>
            {DOWNTIME_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Note (optional)
          <input type="text" name="note" maxLength={MAX_DOWNTIME_NOTE} placeholder="e.g. Annual inspection" className={inputClass} />
        </label>
      </div>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && <p role="status" className="text-xs text-green-700">{state.success}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Checking…" : "Check and save"}
      </button>
      <p className="text-xs text-zinc-500">
        If bookings fall in the period you see them first, and nothing is cancelled until you confirm.
      </p>
    </form>
  );
}
