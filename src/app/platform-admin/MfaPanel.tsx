"use client";

import Image from "next/image";
import { useActionState } from "react";
import { finishEnrolment, startEnrolment, verifyCode, type MfaState } from "./mfa-actions";

const card = "mx-auto flex max-w-sm flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5";
const input = "rounded-md border border-zinc-300 px-3 py-2 text-center font-mono text-xl tracking-widest text-zinc-900";
const button = "rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";

// Signing in with the code from the authenticator app.
export function CodePanel() {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyCode, {});
  return (
    <form action={action} className={card}>
      <h1 className="text-lg font-semibold">Enter your code</h1>
      <p className="text-sm text-zinc-600">Open your authenticator app and type the 6-digit code for Blocktime.</p>
      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required autoFocus className={input} aria-label="6-digit code" />
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className={button}>{pending ? "Checking…" : "Continue"}</button>
    </form>
  );
}

// Setting the authenticator app up for the first time.
export function EnrolPanel() {
  const [started, start, starting] = useActionState<MfaState, FormData>(() => startEnrolment(), {});
  const [finished, finish, finishing] = useActionState<MfaState, FormData>(finishEnrolment, {});
  const enrol = started.enrol;

  if (!enrol) {
    return (
      <form action={start} className={card}>
        <h1 className="text-lg font-semibold">Set up your authenticator app</h1>
        <p className="text-sm text-zinc-600">
          This page needs a second step when you sign in: a 6-digit code from an authenticator app on your phone
          (for example 1Password, Google Authenticator or Microsoft Authenticator).
        </p>
        <p className="text-sm text-zinc-600">Setting it up signs you out on your other devices once.</p>
        {started.error && <p role="alert" className="text-sm text-red-700">{started.error}</p>}
        <button type="submit" disabled={starting} className={button}>{starting ? "Preparing…" : "Show the QR code"}</button>
      </form>
    );
  }

  return (
    <form action={finish} className={card}>
      <h1 className="text-lg font-semibold">Scan the QR code</h1>
      <p className="text-sm text-zinc-600">Scan this with your authenticator app, then type the 6-digit code it shows.</p>
      <Image src={enrol.qr} alt="QR code for the authenticator app" width={192} height={192} unoptimized className="mx-auto h-48 w-48" />
      <details className="text-sm text-zinc-600">
        <summary className="cursor-pointer">Can&apos;t scan? Type the key instead</summary>
        <p className="mt-2 break-all font-mono text-xs text-zinc-900">{enrol.secret}</p>
      </details>
      <input type="hidden" name="factorId" value={enrol.factorId} />
      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required className={input} aria-label="6-digit code" />
      {finished.error && <p role="alert" className="text-sm text-red-700">{finished.error}</p>}
      <button type="submit" disabled={finishing} className={button}>{finishing ? "Checking…" : "Finish setup"}</button>
    </form>
  );
}
