"use server";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";
import { parseSettingValue } from "@/lib/platform-admin/plan-form";

// Changes to the platform-wide settings. Every action first checks, on the server, that this is a
// platform admin who signed in with a code; the database function checks the same again.

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

async function admin() {
  const supabase = await createClient();
  if ((await adminState(supabase)) !== "ok") notFound();
  return supabase;
}

const back = (notice: string, field?: string) =>
  redirect(`/platform-admin?notice=${notice}${field ? `&field=${field}` : ""}#settings`);

// The answer code from the database function -> the notice shown.
const CODES: Record<string, string> = {
  ok: "saved",
  no_change: "no_change",
  reason_required: "reason_required",
  reason_too_long: "reason_too_long",
  invalid: "invalid",
  not_allowed: "not_allowed",
  field_unknown: "invalid",
};

async function save(key: string, value: string | number | boolean | null, reason: string, okNotice = "saved") {
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_update_setting", { p_key: key, p_value: value, p_reason: reason });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back("error");
  const notice = result === "ok" ? okNotice : (CODES[result as string] ?? "error");
  back(notice, notice === "invalid" ? key : undefined);
}

// One of the four ordinary settings.
export async function saveSetting(formData: FormData) {
  const key = text(formData, "key");
  const parsed = parseSettingValue(key, text(formData, "value"));
  if (!parsed.ok) back("invalid", key);
  await save(key, parsed.ok ? parsed.value : null, text(formData, "reason"));
}

// Switching enforcement OFF needs only a reason.
export async function disableEnforcement(formData: FormData) {
  await save("billing_enforcement_enabled", false, text(formData, "reason"), "enforcement_off");
}

// Switching it ON needs the confirmation page: the word ENABLE must be typed.
export async function enableEnforcement(formData: FormData) {
  if (text(formData, "confirm") !== "ENABLE") redirect("/platform-admin/settings/enforcement?notice=confirm_needed");
  await save("billing_enforcement_enabled", true, text(formData, "reason"), "enforcement_on");
}
