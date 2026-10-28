"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathFor } from "@/lib/user-home";
import { acceptanceMetadata, legalDocsLive } from "@/lib/legal";

export type AuthActionState = { error?: string; message?: string };

async function redirectToUsersGroup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  redirect(await homePathFor(supabase, userId));
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: error?.message ?? "Sign-in failed." };
  }

  await redirectToUsersGroup(supabase, data.user.id);
  return {};
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (password.length < 8) {
    return { error: "Please use a password of at least 8 characters." };
  }
  // Where the terms are live the box must be ticked; the versions are stored with the account and
  // recorded at the first signed-in page (src/lib/legal-server.ts).
  const needsTerms = legalDocsLive();
  if (needsTerms && formData.get("acceptTerms") !== "on") {
    return { error: "Please accept the terms and the privacy page to create an account." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.SITE_URL}/auth/callback`,
      ...(needsTerms ? { data: acceptanceMetadata() } : {}),
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    return {
      message: "Check your email to confirm your account, then sign in.",
    };
  }

  await redirectToUsersGroup(supabase, data.user!.id);
  return {};
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
