"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STATUS_FIELDS } from "@/lib/aircraft-status";

export type StatusActionState = { error?: string; success?: boolean };

export async function updateAircraftStatus(
  _prevState: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const groupId = formData.get("groupId") as string;
  const groupSlug = formData.get("groupSlug") as string;

  // One entry per field in STATUS_FIELDS; a blank input clears the value.
  const updates: Record<string, string | number | null> = {};
  for (const field of STATUS_FIELDS) {
    const raw = ((formData.get(field.column) as string) ?? "").trim();
    if (raw === "") {
      updates[field.column] = null;
    } else if (field.kind === "hours") {
      const hours = Number(raw);
      if (Number.isNaN(hours)) {
        return { error: `${field.label} must be a number.` };
      }
      updates[field.column] = hours;
    } else {
      updates[field.column] = raw;
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS restricts this update to group admins; a non-admin submission
  // (shouldn't happen since the form is admin-only) simply matches
  // zero rows rather than erroring.
  const { error } = await supabase
    .from("groups")
    .update(updates)
    .eq("id", groupId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${groupSlug}/aircraft`);
  revalidatePath(`/${groupSlug}`);
  return { success: true };
}
