"use client";

import { useActionState } from "react";
import { createGroup, type CreateGroupState } from "./actions";

const initialState: CreateGroupState = {};

const inputClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-900";

export function CreateGroupForm() {
  const [state, action, pending] = useActionState(createGroup, initialState);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Group name
        <input
          type="text"
          name="name"
          required
          placeholder="e.g. G-BBFD Syndicate"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Aircraft registration
        <input
          type="text"
          name="aircraftRegistration"
          required
          placeholder="e.g. G-BBFD"
          className={`font-mono ${inputClass}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Aircraft type (optional)
        <input
          type="text"
          name="aircraftType"
          placeholder="e.g. PA28R Arrow II"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Home base (optional)
        <input
          type="text"
          name="homeBase"
          placeholder="e.g. EGLM"
          className={`font-mono ${inputClass}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Your name
        <input
          type="text"
          name="displayName"
          required
          placeholder="How other members will see you"
          className={inputClass}
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create group"}
      </button>
    </form>
  );
}
