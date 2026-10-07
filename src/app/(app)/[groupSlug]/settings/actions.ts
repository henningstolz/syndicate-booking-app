"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathFor } from "@/lib/user-home";
import { isDemoRequest } from "@/lib/demo/mode";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { renderTestEmail } from "@/lib/notify/email";
import { notifyConfigured, sendEmail, siteUrl } from "@/lib/notify/send";

// Every action ends by redirecting back to the Settings page with a short
// code in the URL (?notice=...). The page turns the code into a message, so
// no free text ever travels through the address bar.

type RpcResult = { result?: string; cancelled_bookings?: number };

function settingsUrl(groupSlug: string, notice: string, extra = "") {
  return `/${groupSlug}/settings?notice=${notice}${extra}`;
}

// In the demo group nothing here is saved: say so instead of failing.
async function blockInDemo(groupSlug: string, extra = "") {
  if (await isDemoRequest()) redirect(settingsUrl(groupSlug, "demo", extra));
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
  await blockInDemo(groupSlug);

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
  await blockInDemo(groupSlug);

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("leave_group", {
    p_group_id: groupId,
  });
  const result = (data as RpcResult | null)?.result;

  if (error || !result) redirect(settingsUrl(groupSlug, "error"));
  if (result === "ok") {
    // On to another of their groups if they have one.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    redirect(user ? await homePathFor(supabase, user.id) : "/pending");
  }
  redirect(settingsUrl(groupSlug, result));
}

export async function setMemberRole(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  await blockInDemo(groupSlug);

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
  await blockInDemo(groupSlug);

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
  await blockInDemo(groupSlug);
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
  await blockInDemo(groupSlug);

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
  await blockInDemo(groupSlug);
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

// ---------------------------------------------------------------- notifications

const NOTIFICATIONS_TAB = "&tab=notifications";

// Save which events this member wants emailed, for this group.
export async function saveNotificationPreferences(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  await blockInDemo(groupSlug, NOTIFICATIONS_TAB);

  // An unticked box is simply absent from the form, so every known event is
  // saved explicitly: ticked = on, absent = off.
  const prefs = Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [event.key, formData.get(event.key) === "on"]),
  );

  const supabase = await signedInClient();
  const { data, error } = await supabase.rpc("set_notification_preferences", {
    p_group_id: groupId,
    p_prefs: prefs,
  });
  const result = (data as RpcResult | null)?.result;

  if (error || !result) redirect(settingsUrl(groupSlug, "error", NOTIFICATIONS_TAB));
  if (result === "ok") redirect(settingsUrl(groupSlug, "notifications_saved", NOTIFICATIONS_TAB));
  redirect(settingsUrl(groupSlug, result, NOTIFICATIONS_TAB));
}

// Send the member a sample email, to check that notifications reach them.
// Limited to one every 30 seconds.
export async function sendTestEmail(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  await blockInDemo(groupSlug, NOTIFICATIONS_TAB);

  const back = (notice: string) => redirect(settingsUrl(groupSlug, notice, NOTIFICATIONS_TAB));
  if (!notifyConfigured()) back("not_configured");

  const store = await cookies();
  if (store.get("bt_test_email")) back("test_wait");

  const supabase = await signedInClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .maybeSingle<{ name: string }>();
  if (!user?.email || !group) back("error");

  store.set("bt_test_email", "1", { maxAge: 30, path: "/", httpOnly: true, sameSite: "lax" });

  const rendered = renderTestEmail(group!.name, siteUrl());
  const outcome = await sendEmail({
    ...rendered,
    to: user!.email as string,
    unsubscribeUrl: `${siteUrl()}/${encodeURIComponent(groupSlug)}/settings?tab=notifications`,
  });
  back(outcome.ok ? "test_sent" : "test_failed");
}
