"use client";

import { useActionState, useState } from "react";
import { updateAircraftStatus, type StatusActionState } from "./actions";
import {
  STATUS_FIELDS,
  MAX_AIRCRAFT_ITEMS,
  MAX_ITEM_LABEL_LENGTH,
  type AircraftItem,
  type AircraftStatusFields,
} from "@/lib/aircraft-status";

const initialState: StatusActionState = {};

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";

export function AircraftForm({
  groupId,
  groupSlug,
  initial,
  hours,
  items,
}: {
  groupId: string;
  groupSlug: string;
  initial: AircraftStatusFields;
  hours: { total: number | null; checkAt: number | null };
  items: AircraftItem[];
}) {
  // Once the total and the check limit are known, the hours left to the next
  // check are worked out from the flight log, not typed in.
  const hoursCalculated = hours.total !== null && hours.checkAt !== null;
  const [open, setOpen] = useState(false);
  // The equipment list being edited: existing rows keep their id (new rows have none), and the ids of
  // removed rows are remembered so the server can delete them.
  const rowsFrom = (list: AircraftItem[]) =>
    list.map((item) => ({ key: item.id, id: item.id, label: item.label, due: item.due_date ?? "" }));
  const [rows, setRows] = useState(() => rowsFrom(items));
  const [deleted, setDeleted] = useState<string[]>([]);
  const [newKey, setNewKey] = useState(0);
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

  const resetItems = () => {
    setRows(rowsFrom(items));
    setDeleted([]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          resetItems();
          setOpen(true);
        }}
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

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-zinc-600">
          Equipment (life raft, first aid kit, ...). Rename, remove or add items to suit the group.
        </legend>
        <input type="hidden" name="itemsPresent" value="1" />
        {deleted.map((id) => (
          <input key={id} type="hidden" name="itemDeleted" value={id} />
        ))}
        {rows.map((row, index) => {
          const original = items.find((item) => item.id === row.id);
          return (
            <div key={row.key} className="flex items-end gap-2">
              <input type="hidden" name="itemId" value={row.id} />
              <input type="hidden" name="itemOrigLabel" value={original?.label ?? ""} />
              <input type="hidden" name="itemOrigDue" value={original?.due_date ?? ""} />
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-600">
                Name
                <input
                  type="text"
                  name="itemLabel"
                  value={row.label}
                  maxLength={MAX_ITEM_LABEL_LENGTH}
                  required
                  placeholder="e.g. First aid kit"
                  onChange={(e) =>
                    setRows((all) => all.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-600">
                Due
                <input
                  type="date"
                  name="itemDue"
                  value={row.due}
                  onChange={(e) =>
                    setRows((all) => all.map((r, i) => (i === index ? { ...r, due: e.target.value } : r)))
                  }
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                aria-label={`Remove ${row.label || "this item"}`}
                onClick={() => {
                  if (row.id) setDeleted((ids) => [...ids, row.id]);
                  setRows((all) => all.filter((_, i) => i !== index));
                }}
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                Remove
              </button>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-xs text-zinc-500">No equipment items. Add one below.</p>
        )}
        <button
          type="button"
          disabled={rows.length >= MAX_AIRCRAFT_ITEMS}
          onClick={() => {
            setRows((all) => [...all, { key: `new-${newKey}`, id: "", label: "", due: "" }]);
            setNewKey((n) => n + 1);
          }}
          className="self-start rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-400 disabled:opacity-50"
        >
          Add item
        </button>
        {rows.length >= MAX_AIRCRAFT_ITEMS && (
          <p className="text-xs text-zinc-500">A group can have at most {MAX_AIRCRAFT_ITEMS} items.</p>
        )}
      </fieldset>

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
          onClick={() => {
            resetItems();
            setOpen(false);
          }}
          className="rounded-full px-4 py-1.5 text-xs font-medium text-zinc-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
