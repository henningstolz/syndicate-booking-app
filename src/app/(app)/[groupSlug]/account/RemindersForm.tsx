"use client";

import { useActionState, useState } from "react";
import { saveReminders, type RemindersActionState } from "./reminders-actions";
import {
  MAX_PERSONAL_REMINDERS,
  MAX_REMINDER_LABEL_LENGTH,
  type PersonalReminder,
} from "@/lib/personal-reminders";

const initialState: RemindersActionState = {};

const inputClass = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";

// The Edit form for a person's own reminders: rename, set the date, remove, or add one of your own.
export function RemindersForm({ groupSlug, items }: { groupSlug: string; items: PersonalReminder[] }) {
  const [open, setOpen] = useState(false);
  // Existing rows keep their id (new rows have none); the ids of removed rows are remembered so the
  // server can delete them.
  const rowsFrom = (list: PersonalReminder[]) =>
    list.map((item) => ({ key: item.id, id: item.id, label: item.label, due: item.due_date ?? "" }));
  const [rows, setRows] = useState(() => rowsFrom(items));
  const [deleted, setDeleted] = useState<string[]>([]);
  const [newKey, setNewKey] = useState(0);
  const [state, action, pending] = useActionState(saveReminders, initialState);

  // Close the form once a save succeeds, without the extra render an effect would cost.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success && open) setOpen(false);
  }

  const reset = () => {
    setRows(rowsFrom(items));
    setDeleted([]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="self-start rounded-full border border-dashed border-zinc-300 px-4 py-1.5 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
      >
        Edit
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-zinc-50 p-3">
      <input type="hidden" name="groupSlug" value={groupSlug} />
      {deleted.map((id) => (
        <input key={id} type="hidden" name="reminderDeleted" value={id} />
      ))}
      {rows.map((row, index) => {
        const original = items.find((item) => item.id === row.id);
        return (
          <div key={row.key} className="flex items-end gap-2">
            <input type="hidden" name="reminderId" value={row.id} />
            <input type="hidden" name="reminderOrigLabel" value={original?.label ?? ""} />
            <input type="hidden" name="reminderOrigDue" value={original?.due_date ?? ""} />
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-600">
              Name
              <input
                type="text"
                name="reminderLabel"
                value={row.label}
                maxLength={MAX_REMINDER_LABEL_LENGTH}
                required
                placeholder="e.g. First aid course"
                onChange={(e) =>
                  setRows((all) => all.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-600">
              Expires
              <input
                type="date"
                name="reminderDue"
                value={row.due}
                onChange={(e) =>
                  setRows((all) => all.map((r, i) => (i === index ? { ...r, due: e.target.value } : r)))
                }
                className={inputClass}
              />
            </label>
            <button
              type="button"
              aria-label={`Remove ${row.label || "this reminder"}`}
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
      {rows.length === 0 && <p className="text-xs text-zinc-500">No reminders. Add one below.</p>}
      <button
        type="button"
        disabled={rows.length >= MAX_PERSONAL_REMINDERS}
        onClick={() => {
          setRows((all) => [...all, { key: `new-${newKey}`, id: "", label: "", due: "" }]);
          setNewKey((n) => n + 1);
        }}
        className="self-start rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-400 disabled:opacity-50"
      >
        Add reminder
      </button>
      {rows.length >= MAX_PERSONAL_REMINDERS && (
        <p className="text-xs text-zinc-500">You can have at most {MAX_PERSONAL_REMINDERS} reminders.</p>
      )}

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
            reset();
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
