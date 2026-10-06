"use client";

import { useActionState, useState } from "react";
import { addFlightEntry, type FlightActionState } from "./flight-actions";
import {
  flightDurations,
  formatDeci,
  formatDuration,
} from "@/lib/flight-times";

const initialState: FlightActionState = {};

const inputClass =
  "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900";
const labelClass = "flex flex-col gap-1 text-xs text-zinc-600";

type MemberOption = { user_id: string; display_name: string | null };

type Fields = {
  date: string;
  from: string;
  to: string;
  category: string;
  captain: string;
  guestName: string;
  fuelLeft: string;
  fuelRight: string;
  oil: string;
  brakesOff: string;
  airborne: string;
  landed: string;
  brakesOn: string;
  defects: string;
};

// A fuel box can be empty or a number; only add up when both are numbers.
const toNumber = (raw: string) => (raw.trim() === "" ? null : Number(raw));

export function FlightForm({
  groupId,
  groupSlug,
  defaultDate,
  members,
  myUserId,
}: {
  groupId: string;
  groupSlug: string;
  defaultDate: string;
  members: MemberOption[];
  myUserId: string;
}) {
  const blank: Fields = {
    date: defaultDate,
    from: "",
    to: "",
    category: "PV",
    captain: `member:${myUserId}`,
    guestName: "",
    fuelLeft: "",
    fuelRight: "",
    oil: "",
    brakesOff: "",
    airborne: "",
    landed: "",
    brakesOn: "",
    defects: "",
  };

  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(blank);
  const [state, action, pending] = useActionState(addFlightEntry, initialState);

  // Close and clear after a successful save, in the render itself rather than
  // an effect (the same pattern as the booking form). The fields are kept as
  // typed when the server answers with a problem.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success && open) {
      setOpen(false);
      setFields({ ...blank, from: fields.from, to: fields.to });
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-zinc-300 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
      >
        + Entry
      </button>
    );
  }

  const set = (key: keyof Fields) => (
    event: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => setFields((current) => ({ ...current, [key]: event.target.value }));

  const durations = flightDurations([
    fields.brakesOff,
    fields.airborne,
    fields.landed,
    fields.brakesOn,
  ]);
  const left = toNumber(fields.fuelLeft);
  const right = toNumber(fields.fuelRight);
  const fuelTotal =
    left !== null && right !== null && !Number.isNaN(left + right)
      ? left + right
      : null;
  const isGuest = fields.captain === "guest";

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-zinc-50 p-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupSlug" value={groupSlug} />

      <label className={labelClass}>
        Date (of brakes off)
        <input
          type="date"
          name="date"
          required
          max={defaultDate}
          value={fields.date}
          onChange={set("date")}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          From
          <input
            type="text"
            name="from"
            required
            maxLength={40}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="EGLM"
            value={fields.from}
            onChange={set("from")}
            className={`${inputClass} uppercase`}
          />
        </label>
        <label className={labelClass}>
          To
          <input
            type="text"
            name="to"
            required
            maxLength={40}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="EGLM"
            value={fields.to}
            onChange={set("to")}
            className={`${inputClass} uppercase`}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Flight category
          <select
            name="category"
            value={fields.category}
            onChange={set("category")}
            className={inputClass}
          >
            <option value="PV">Private (PV)</option>
            <option value="TG">Training (TG)</option>
            <option value="PT">Public transport (PT)</option>
          </select>
        </label>
        <label className={labelClass}>
          Captain
          <select
            name="captain"
            value={fields.captain}
            onChange={set("captain")}
            className={inputClass}
          >
            {members.map((member) => (
              <option key={member.user_id} value={`member:${member.user_id}`}>
                {member.display_name ?? "Member"}
                {member.user_id === myUserId ? " (you)" : ""}
              </option>
            ))}
            <option value="guest">Someone else…</option>
          </select>
        </label>
      </div>

      {isGuest && (
        <label className={labelClass}>
          Captain&apos;s name
          <input
            type="text"
            name="guestName"
            required
            maxLength={60}
            value={fields.guestName}
            onChange={set("guestName")}
            className={inputClass}
          />
        </label>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-zinc-600">
          Fuel in each tank at departure (US gallons)
        </legend>
        <div className="grid grid-cols-3 items-end gap-3">
          <label className={labelClass}>
            Left
            <input
              type="number"
              name="fuelLeft"
              required
              min="0"
              max="100"
              step="0.1"
              inputMode="decimal"
              value={fields.fuelLeft}
              onChange={set("fuelLeft")}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Right
            <input
              type="number"
              name="fuelRight"
              required
              min="0"
              max="100"
              step="0.1"
              inputMode="decimal"
              value={fields.fuelRight}
              onChange={set("fuelRight")}
              className={inputClass}
            />
          </label>
          <p className="pb-2 font-mono text-sm text-zinc-700">
            {fuelTotal === null ? "Total –" : `Total ${fuelTotal.toFixed(1)}`}
          </p>
        </div>
      </fieldset>

      <label className={labelClass}>
        Oil level before flight (US quarts)
        <input
          type="number"
          name="oil"
          required
          min="0"
          max="20"
          step="0.5"
          inputMode="decimal"
          value={fields.oil}
          onChange={set("oil")}
          className={inputClass}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-zinc-600">Times (UK local)</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Brakes off
            <input
              type="time"
              name="brakesOff"
              required
              value={fields.brakesOff}
              onChange={set("brakesOff")}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Airborne
            <input
              type="time"
              name="airborne"
              required
              value={fields.airborne}
              onChange={set("airborne")}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Landed
            <input
              type="time"
              name="landed"
              required
              value={fields.landed}
              onChange={set("landed")}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Brakes on
            <input
              type="time"
              name="brakesOn"
              required
              value={fields.brakesOn}
              onChange={set("brakesOn")}
              className={inputClass}
            />
          </label>
        </div>
        <p className="font-mono text-sm text-zinc-700" aria-live="polite">
          {durations
            ? `Flight ${formatDuration(durations.flightMinutes)} = ${formatDeci(durations.flightDeci)} h · Block ${formatDuration(durations.blockMinutes)} = ${formatDeci(durations.blockDeci)} h`
            : "Flight and block time appear once all four times are in."}
        </p>
      </fieldset>

      <label className={labelClass}>
        Defects (leave empty if none)
        <textarea
          name="defects"
          rows={3}
          maxLength={2000}
          value={fields.defects}
          onChange={set("defects")}
          className={inputClass}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add entry"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
