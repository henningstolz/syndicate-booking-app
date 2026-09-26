"use client";

import { useActionState } from "react";
import { acceptInvite, type AcceptInviteState } from "./actions";

const initialState: AcceptInviteState = {};

export function AcceptInviteForm({ inviteId }: { inviteId: string }) {
  const [state, action, pending] = useActionState(acceptInvite, initialState);

  return (
    <form action={action} className="flex w-full max-w-xs flex-col gap-4">
      <input type="hidden" name="inviteId" value={inviteId} />
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        Your name
        <input
          type="text"
          name="displayName"
          required
          placeholder="How other members will see you"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-900"
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
