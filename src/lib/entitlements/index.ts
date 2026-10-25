import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoRequest } from "@/lib/demo/mode";
import type { Entitlements } from "./compute-mode.ts";
import { evaluateEntitlements, unavailable } from "./evaluate.ts";

// The one place the app asks "may this group write?" See docs/entitlements.md.

export const READ_ONLY_MESSAGE = "This group is read-only at the moment. Please contact your group admin.";

export async function getEntitlements(supabase: SupabaseClient, groupId: string): Promise<Entitlements> {
  // The demo runs on invented data and never limits anyone.
  if (await isDemoRequest()) return unavailable("demo");
  try {
    const { data, error } = await supabase.rpc("get_group_entitlement_inputs", { p_group_id: groupId });
    if (error) {
      // Allow the write, but let us know (the code only, nothing about the group).
      Sentry.captureException(new Error(`entitlement check failed: ${error.code ?? "rpc error"}`));
      return unavailable("check_failed");
    }
    return evaluateEntitlements(data, new Date());
  } catch (error) {
    Sentry.captureException(error);
    return unavailable("check_failed");
  }
}

// Call this before a write. It returns null when writing is allowed, or the error to show. It
// returns a value rather than throwing because the actions answer with an error state or a
// redirect, not an exception.
export async function assertCanWrite(supabase: SupabaseClient, groupId: string): Promise<{ error: string } | null> {
  const { mode } = await getEntitlements(supabase, groupId);
  return mode === "read_only" ? { error: READ_ONLY_MESSAGE } : null;
}
