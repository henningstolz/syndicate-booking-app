"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathFor } from "@/lib/user-home";

export type ResetPasswordState = { error?: string };

const MIN_PASSWORD_LENGTH = 8;

export async function updatePassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = (formData.get("password") as string | null) ?? "";
  const confirm = (formData.get("confirm") as string | null) ?? "";

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Please use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password !== confirm) {
    return { error: "The two passwords don't match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/forgot-password?error=expired");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  // Anyone else signed in with the old password (another phone, a stolen
  // session) is signed out; this device stays signed in.
  await supabase.auth.signOut({ scope: "others" });

  redirect(await homePathFor(supabase, user.id));
}
