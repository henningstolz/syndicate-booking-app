"use server";

import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";

// The authenticator-app (TOTP) sign-in for platform admins. Only a platform admin can reach any of
// this; everyone else gets the 404 page. Verifying a code upgrades the session to aal2 and the
// cookies are refreshed here, so the next request is recognised as signed in with a code.

export type MfaState = {
  error?: string;
  enrol?: { factorId: string; qr: string; secret: string };
};

const CODE = /^\d{6}$/;
const WRONG_CODE = "That code did not work. Check the app and try again (codes change every 30 seconds).";

// Step 1 of setting up: make a new authenticator factor and hand back the QR code and secret.
export async function startEnrolment(): Promise<MfaState> {
  const supabase = await createClient();
  const state = await adminState(supabase);
  if (state === "not_admin") notFound();
  // First time, or (already signed in with a code) an extra device. Supabase itself refuses to add a device
  // to an account that has one unless the session was signed in with a code.
  if (state !== "needs_enrolment" && state !== "ok") return { error: "Sign in with your code first." };

  // An earlier attempt that was never finished would block a new one; remove it.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Blocktime platform admin" });
  if (error || !data) {
    return { error: "Could not start the setup. Check that authenticator sign-in (TOTP) is switched on for this project." };
  }
  return { enrol: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

// Step 2: the first code from the app proves it was set up, and signs this session in with a code.
export async function finishEnrolment(prev: MfaState, formData: FormData): Promise<MfaState> {
  const supabase = await createClient();
  const state = await adminState(supabase);
  if (state === "not_admin") notFound();
  if (state !== "needs_enrolment" && state !== "ok") return { ...prev, error: "Sign in with your code first." };

  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!CODE.test(code)) return { ...prev, error: "Enter the 6-digit code from the app." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ...prev, error: WRONG_CODE };
  redirect(state === "ok" ? "/platform-admin?notice=device_added" : "/platform-admin");
}

// Signing in on a later day: the code from the app.
export async function verifyCode(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const supabase = await createClient();
  const state = await adminState(supabase);
  if (state === "not_admin") notFound();
  if (state !== "needs_code") redirect("/platform-admin");

  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!CODE.test(code)) return { error: "Enter the 6-digit code from the app." };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) return { error: "No authenticator app found for this account." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: WRONG_CODE };
  redirect("/platform-admin");
}
