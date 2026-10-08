"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { parsePounds } from "@/lib/costs";

// Admins keep the money side: the group's rates, members' own rates, the
// expenses members paid out of their own pocket, and closing a month. Every action ends by
// redirecting back to the month being looked at, with a short notice code in
// the address (the page turns it into a message).

const text = (formData: FormData, key: string) =>
  ((formData.get(key) as string | null) ?? "").trim();

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function back(groupSlug: string, view: string, notice: string) {
  const month = MONTH.test(view) ? `month=${view}&` : "";
  return redirect(`/${groupSlug}/costs?${month}notice=${notice}`);
}

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return supabase;
}

// The invented demo group never saves anything.
async function blockInDemo(groupSlug: string, view: string) {
  if (await isDemoRequest()) back(groupSlug, view, "demo");
}

// Set the group's fixed monthly share and hourly rate from a month onwards.
export async function saveCostRate(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);

  const month = text(formData, "month");
  const fee = parsePounds(text(formData, "fee"));
  const hourly = parsePounds(text(formData, "hourly"));
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) back(groupSlug, view, "month_invalid");
  if (fee === null || hourly === null) back(groupSlug, view, "amount_invalid");

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("set_cost_rate", {
    p_group_id: groupId,
    p_month: month,
    p_fee_pence: fee,
    p_hourly_pence: hourly,
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "rate_saved" : (result as string));
}

// A box left empty means "follow the group's rate"; 0 is a real zero.
function optionalPounds(value: string): number | null | undefined {
  if (value === "") return null;
  return parsePounds(value) ?? undefined;
}

// Set one member's own fixed share and/or hourly rate from a month onwards.
// Saving with both boxes empty puts the member back on the group's rates.
export async function saveMemberCostRate(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);

  const month = text(formData, "month");
  const fee = optionalPounds(text(formData, "fee"));
  const hourly = optionalPounds(text(formData, "hourly"));
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) back(groupSlug, view, "month_invalid");
  if (fee === undefined || hourly === undefined) back(groupSlug, view, "amount_invalid");

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("set_member_cost_rate", {
    p_group_id: groupId,
    p_user_id: text(formData, "memberId"),
    p_month: month,
    p_fee_pence: fee,
    p_hourly_pence: hourly,
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "member_rate_saved" : (result as string));
}

// Record something a member paid for the group out of their own pocket (fuel
// bought at another airfield, say). It is credited on their statement.
export async function addCostExpense(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);

  const amount = parsePounds(text(formData, "amount"));
  if (amount === null || amount < 1) back(groupSlug, view, "amount_invalid");

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("add_cost_expense", {
    p_group_id: groupId,
    p_paid_by: text(formData, "memberId"),
    p_date: text(formData, "date"),
    p_description: text(formData, "description"),
    p_amount_pence: amount,
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "expense_added" : (result as string));
}

// Take a wrong expense out of the statements, with a reason. It stays listed.
export async function voidCostExpense(formData: FormData) {
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("void_cost_expense", {
    p_id: text(formData, "expenseId"),
    p_reason: text(formData, "reason"),
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "expense_voided" : (result as string));
}

// Close a finished month: its figures are saved and stop moving.
export async function closeCostMonth(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);
  if (!MONTH.test(view)) back(groupSlug, view, "month_invalid");

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("close_cost_month", {
    p_group_id: groupId,
    p_month: `${view}-01`,
    p_note: text(formData, "note") || null,
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "month_closed_done" : (result as string));
}

// Reopen a closed month, with a reason. The closure stays on record.
export async function reopenCostMonth(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);
  if (!MONTH.test(view)) back(groupSlug, view, "month_invalid");

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("reopen_cost_month", {
    p_group_id: groupId,
    p_month: `${view}-01`,
    p_reason: text(formData, "reason"),
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "month_reopened" : (result as string));
}
