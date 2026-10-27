"use server";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";
import { parseAdminGroups } from "@/lib/platform-admin/groups";
import { buildPlanChanges, PLAN_FIELDS } from "@/lib/platform-admin/plan-form";

// Saves a change to one group's plan fields. Only the fields that changed are sent, with the reason.
// The database function writes the change and its history entry in one step.

const CODES: Record<string, string> = {
  ok: "saved", no_change: "no_change", reason_required: "reason_required", reason_too_long: "reason_too_long",
  invalid: "invalid", changes_invalid: "changes_invalid", not_found: "not_found", not_allowed: "not_allowed", field_unknown: "invalid",
};

export async function saveGroupPlan(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) notFound();
  const back = (notice: string, field?: string) => redirect(`/platform-admin/groups/${groupId}?notice=${notice}${field ? `&field=${field}` : ""}`);

  const supabase = await createClient();
  if ((await adminState(supabase)) !== "ok") notFound();

  const { data: listed } = await supabase.rpc("admin_list_groups");
  const group = parseAdminGroups(listed)?.find((g) => g.group_id === groupId);
  if (!group) back("not_found");

  const form: Record<string, string> = {};
  for (const field of PLAN_FIELDS) form[field] = String(formData.get(field) ?? "");
  const parsed = buildPlanChanges(form, group!);
  if (!parsed.ok) back("invalid", parsed.field);
  if (parsed.ok && Object.keys(parsed.changes).length === 0) back("no_change");

  const { data, error } = await supabase.rpc("admin_update_group_plan", {
    p_group_id: groupId,
    p_changes: parsed.ok ? parsed.changes : {},
    p_reason: String(formData.get("reason") ?? ""),
  });
  const answer = data as { result?: string; field?: string } | null;
  if (error || !answer?.result) back("error");
  back(CODES[answer!.result as string] ?? "error", answer!.field);
}
