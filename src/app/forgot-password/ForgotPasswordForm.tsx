"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = {};

export function ForgotPasswordForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  return (
    <form action={action} className="flex w-full max-w-xs flex-col gap-4">
      {expired && !state.message && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800"
        >
          That reset link has expired or was already used. Request a new one
          below, and open it in the same browser.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-900"
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.message && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
