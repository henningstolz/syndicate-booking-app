"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Every action ends by redirecting back to the Settings page with a short
// code in the URL (?notice=...). The page turns the code into a message, so
// no free text ever travels through the address bar.

type RpcResult = { result?: string; cancelled_bookings?: number };

function settingsUrl(groupSlug: string, notice: string, extra = "") {
  return `/${groupSlug}/settings?notice=${notice}${extra}`;
}

async function signedInClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return supabase;
}

function text(formData: FormData, key: string) {
  return ((formData.get(key) as string | null) ?? "").trim();
}

export async function updateDisplayName(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("set_my_display_name", {
    p_group_id: groupId,
    p_display_name: text(formData, "displayName"),
  });
  const result = (data as RpcResult | null)?.result;

  if (error || !result) redirect(settingsUrl(groupSlug, "error"));
  if (result === "ok") redirect(settingsUrl(groupSlug, "name_saved"));
  redirect(settingsUrl(groupSlug, result));
}

export async function leaveGroup(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("leave_group", {
    p_group_id: groupId,
  });
  const result = (data as RpcResult | null)?.result;

  if (error || !result) redirect(settingsUrl(groupSlug, "error"));
  if (result === "ok") redirect("/pending");
  redirect(settingsUrl(groupSlug, result));
}

export async function setMemberRole(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("set_member_role", {
    p_group_id: groupId,
    p_user_id: text(formData, "userId"),
    p_role: text(formData, "role"),
  });
  const result = (data as RpcResult | null)?.result;

  if (error || !result) redirect(settingsUrl(groupSlug, "error"));
  if (result === "ok") redirect(settingsUrl(groupSlug, "role_changed"));
  redirect(settingsUrl(groupSlug, result));
}

export async function removeMember(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("remove_member", {
    p_group_id: groupId,
    p_user_id: text(formData, "userId"),
  });
  const body = data as RpcResult | null;

  if (error || !body?.result) redirect(settingsUrl(groupSlug, "error"));
  if (body.result === "ok") {
    redirect(
      settingsUrl(groupSlug, "removed", `&n=${body.cancelled_bookings ?? 0}`),
    );
  }
  redirect(settingsUrl(groupSlug, body.result));
}

export async function createInvite(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const role = text(formData, "role");
  const label = text(formData, "label");

  if (role !== "member" && role !== "admin") {
    redirect(settingsUrl(groupSlug, "error"));
  }
  if (label.length > 60) {
    redirect(settingsUrl(groupSlug, "label_too_long"));
  }

  const supabase = await signedInClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Row-level security allows this only for admins of the group.
  const { error } = await supabase.from("invites").insert({
    group_id: groupId,
    role,
    label: label || null,
    created_by: user!.id,
  });

  if (error) redirect(settingsUrl(groupSlug, "not_allowed"));
  redirect(settingsUrl(groupSlug, "invite_created"));
}

export async function revokeInvite(formData: FormData) {
  const groupSlug = text(formData, "groupSlug");

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("revoke_invite", {
    p_invite_id: text(formData, "inviteId"),
  });
  const result = (data as RpcResult | null)?.result;

  if (error || !result) redirect(settingsUrl(groupSlug, "error"));
  if (result === "ok") redirect(settingsUrl(groupSlug, "invite_revoked"));
  redirect(settingsUrl(groupSlug, result));
}

export async function updateGroupDetails(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const name = text(formData, "name");
  const registration = text(formData, "aircraftRegistration");

  if (!name || !registration) {
    redirect(settingsUrl(groupSlug, "details_required"));
  }

  const supabase = await signedInClient();

  // Row-level security lets only group admins update a group; for anyone
  // else the update matches no rows, which we report as "not allowed".
  const { data, error } = await supabase
    .from("groups")
    .update({
      name,
      aircraft_registration: registration,
      aircraft_type: text(formData, "aircraftType") || null,
      home_base: text(formData, "homeBase") || null,
    })
    .eq("id", groupId)
    .select("id");

  if (error) redirect(settingsUrl(groupSlug, "error"));
  if (!data || data.length === 0) redirect(settingsUrl(groupSlug, "not_allowed"));
  redirect(settingsUrl(groupSlug, "details_saved"));
}
