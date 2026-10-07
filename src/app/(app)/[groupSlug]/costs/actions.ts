"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { parsePounds } from "@/lib/costs";

// Admins keep the money side: the rates, and the shared costs (fuel and so
// on). Every action ends by redirecting back to the month being looked at,
// with a short notice code in the address (the page turns it into a message).

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

// Set the fixed monthly share and the hourly rate from a month onwards.
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

// Record a shared cost: fuel, or something else shared by hours.
export async function addCostItem(formData: FormData) {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);

  const amount = parsePounds(text(formData, "amount"));
  if (amount === null || amount < 1) back(groupSlug, view, "amount_invalid");

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("add_cost_item", {
    p_group_id: groupId,
    p_date: text(formData, "date"),
    p_category: text(formData, "category"),
    p_description: text(formData, "description"),
    p_amount_pence: amount,
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "item_added" : (result as string));
}

// Take a wrong cost out of the statements, with a reason. It stays listed.
export async function voidCostItem(formData: FormData) {
  const groupSlug = text(formData, "groupSlug");
  const view = text(formData, "view");
  await blockInDemo(groupSlug, view);

  const supabase = await signedIn();
  const { data, error } = await supabase.rpc("void_cost_item", {
    p_id: text(formData, "itemId"),
    p_reason: text(formData, "reason"),
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) back(groupSlug, view, "error");
  back(groupSlug, view, result === "ok" ? "item_voided" : (result as string));
}
