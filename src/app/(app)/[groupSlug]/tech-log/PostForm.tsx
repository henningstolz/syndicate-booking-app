"use client";

import { useActionState, useEffect, useRef } from "react";
import { postSquawk, type SquawkActionState } from "./actions";

const initialState: SquawkActionState = {};

export function PostForm({
  groupId,
  groupSlug,
}: {
  groupId: string;
  groupSlug: string;
}) {
  const [state, action, pending] = useActionState(postSquawk, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Refs are a DOM escape hatch, not render state — clearing the
  // textarea after a successful post belongs in an effect, not
  // during render (unlike the setState-during-render pattern used
  // elsewhere in this app, which is a different, sanctioned case).
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-col gap-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupSlug" value={groupSlug} />
      <textarea
        name="message"
        required
        rows={3}
        placeholder="Share something with the group…"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Posting…" : "Post"}
      </button>
    </form>
  );
}
