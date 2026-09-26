"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type JoinAuthState = { error?: string; message?: string };
export type AcceptInviteState = { error?: string };

type InviteInfo = {
  group_id: string;
  group_slug: string;
  group_name: string;
  role: string;
  is_valid: boolean;
};

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

export async function acceptInvite(
  _prevState: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const inviteId = formData.get("inviteId") as string;
  const displayName = (formData.get("displayName") as string)?.trim();

  if (!displayName) {
    return { error: "Please enter your name." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: info } = await supabase
    .rpc("get_invite_info", { invite_id: inviteId })
    .returns<InviteInfo[]>()
    .maybeSingle();

  if (!info || !info.is_valid) {
    return { error: "This invite is no longer valid." };
  }

  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: info.group_id,
    user_id: user.id,
    role: info.role,
    display_name: displayName,
  });

  if (memberError) {
    return { error: "Could not join — the invite may have just been used." };
  }

  // Best-effort: mark it used so it can't be reused. If this fails
  // after the insert above already succeeded, the user has still
  // joined — worst case the invite stays claimable, which the group's
  // admin can just ignore.
  await supabase
    .from("invites")
    .update({ used_by: user.id, used_at: new Date().toISOString() })
    .eq("id", inviteId);

  redirect(`/${info.group_slug}`);
}
