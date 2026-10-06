"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type JoinAuthState = { error?: string; message?: string };
export type AcceptInviteState = { error?: string };

export async function joinSignIn(
  _prevState: JoinAuthState,
  formData: FormData,
): Promise<JoinAuthState> {
  const inviteId = formData.get("inviteId") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Land back on this same page, now authenticated — it'll show the
  // "confirm and join" step instead of the sign-in/up choice.
  redirect(`/join/${inviteId}`);
}

export async function joinSignUp(
  _prevState: JoinAuthState,
  formData: FormData,
): Promise<JoinAuthState> {
  const inviteId = formData.get("inviteId") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.SITE_URL}/auth/callback?next=/join/${inviteId}`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    return {
      message:
        "Check your email to confirm your account, then come back to this link.",
    };
  }

  redirect(`/join/${inviteId}`);
}

const ACCEPT_ERRORS: Record<string, string> = {
  name_required: "Please enter your name.",
  name_too_long: "That name is too long. Please use 60 characters or fewer.",
  invalid: "This invite doesn't exist. Ask whoever sent it for a new one.",
  used: "This invite has already been used. Ask for a new one.",
  revoked: "This invite was cancelled. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
};

export async function acceptInvite(
  _prevState: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const inviteId = formData.get("inviteId") as string;
  const displayName = (formData.get("displayName") as string)?.trim();

  if (!displayName) {
    return { error: ACCEPT_ERRORS.name_required };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // One database function validates the invite, adds (or re-adds) the
  // member and marks the invite used, all in one step.
  const { data, error } = await supabase.rpc("accept_invite", {
    p_invite_id: inviteId,
    p_display_name: displayName,
  });

  if (error || !data) {
    return { error: "Could not join. Please try again." };
  }

  const { result, group_slug: groupSlug } = data as {
    result: string;
    group_slug?: string;
  };

  // Already a member: no harm done, just take them to the group.
  if ((result === "ok" || result === "already_member") && groupSlug) {
    redirect(`/${groupSlug}`);
  }

  return { error: ACCEPT_ERRORS[result] ?? "Could not join. Please try again." };
}
