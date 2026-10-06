"use server";

import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { error?: string; message?: string };

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = ((formData.get("email") as string | null) ?? "").trim();
  if (!email) {
    return { error: "Please enter your email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.SITE_URL}/auth/callback?next=/reset-password`,
  });

  // Supabase reports success whether or not the address has an account, and
  // so do we, so nobody can use this form to find out who is registered.
  // Only a rate limit is worth telling the person about.
  if (error?.status === 429) {
    return {
      error: "Too many requests. Please wait a minute and try again.",
    };
  }

  return {
    message:
      "If that address has an account, a reset link is on its way. Check your inbox (and spam folder). Open the link in the same browser you are using now.",
  };
}
