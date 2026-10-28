"use client";

import { useActionState } from "react";
import { AcceptTermsCheckbox } from "@/components/AcceptTermsCheckbox";
import { acceptTerms, type AcceptState } from "./actions";

export function AcceptForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptTerms, {});
  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <AcceptTermsCheckbox />
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
        {pending ? "Please wait…" : "Continue"}
      </button>
    </form>
  );
}
