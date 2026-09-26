"use client";

import { useActionState, useState } from "react";
import { joinSignIn, joinSignUp, type JoinAuthState } from "./actions";

const initialState: JoinAuthState = {};

export function JoinAuthForm({ inviteId }: { inviteId: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [signInState, signInAction, signInPending] = useActionState(
    joinSignIn,
    initialState,
  );
  const [signUpState, signUpAction, signUpPending] = useActionState(
    joinSignUp,
    initialState,
  );

  const isSignIn = mode === "sign-in";
  const state = isSignIn ? signInState : signUpState;
  const action = isSignIn ? signInAction : signUpAction;
  const pending = isSignIn ? signInPending : signUpPending;

  return (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="inviteId" value={inviteId} />
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
        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          Password
          <input
            type="password"
            name="password"
            required
            minLength={6}
            autoComplete={isSignIn ? "current-password" : "new-password"}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-900"
          />
        </label>

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.message && (
          <p className="text-sm text-emerald-700">{state.message}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Please wait…" : isSignIn ? "Sign in" : "Sign up"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(isSignIn ? "sign-up" : "sign-in")}
        className="text-sm text-zinc-500 underline underline-offset-4"
      >
        {isSignIn
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
