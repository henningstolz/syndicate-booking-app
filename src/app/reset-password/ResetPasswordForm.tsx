"use client";

import { useActionState } from "react";
import { updatePassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={action} className="flex w-full max-w-xs flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        New password
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-900"
        />
        <span className="text-xs text-zinc-500">At least 8 characters.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        New password again
        <input
          type="password"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-900"
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
