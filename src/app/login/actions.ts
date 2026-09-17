"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = { error?: string; message?: string };

async function redirectToUsersGroup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    redirect("/pending");
  }

  const { data: group } = await supabase
    .from("groups")
    .select("slug")
    .eq("id", membership.group_id)
    .single();

  if (!group) {
    redirect("/pending");
  }

  redirect(`/${group.slug}`);
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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

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
  redirect("/login");
}
