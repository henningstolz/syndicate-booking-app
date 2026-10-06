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
    // A field the form did not send (the hours to the next check, once it is
    // calculated from the flight log) is left alone, not cleared.
    if (!formData.has(field.column)) continue;
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

  // Airframe hours and the check limit. The database works out the baseline
  // from "the total is X right now" and keeps the hours to the next check up
  // to date from the flight log, so this is separate from the plain columns
  // above. Only touched when one of the two figures was actually changed.
  const field = (key: string) => ((formData.get(key) as string) ?? "").trim();
  const totalRaw = field("airframeTotalHours");
  const checkRaw = field("nextCheckAtHours");
  if (
    totalRaw !== field("airframeTotalOriginal") ||
    checkRaw !== field("nextCheckAtOriginal")
  ) {
    if (Number.isNaN(Number(totalRaw)) || Number.isNaN(Number(checkRaw))) {
      return { error: "Airframe hours must be numbers." };
    }

    let total: number | null = totalRaw === "" ? null : Number(totalRaw);
    if (totalRaw === field("airframeTotalOriginal")) {
      // Total unchanged: use the live figure, so a flight logged while this
      // form was open is not wiped out by a stale number.
      const { data: live } = await supabase
        .from("groups")
        .select("airframe_total_hours")
        .eq("id", groupId)
        .maybeSingle();
      total = live?.airframe_total_hours ?? null;
    }
    if (total === null) {
      return { error: "Enter the airframe total hours first." };
    }

    const { data: hoursResult, error: hoursError } = await supabase.rpc(
      "set_airframe_hours",
      {
        p_group_id: groupId,
        p_total_hours: total,
        p_next_check_at: checkRaw === "" ? null : Number(checkRaw),
      },
    );
    const outcome = (hoursResult as { result?: string } | null)?.result;
    if (hoursError || outcome !== "ok") {
      return {
        error:
          outcome === "hours_invalid"
            ? "Those airframe hours are not valid."
            : outcome === "not_allowed"
              ? "Only admins can change the airframe hours."
              : "Could not save the airframe hours.",
      };
    }
  }

  revalidatePath(`/${groupSlug}/aircraft`);
  revalidatePath(`/${groupSlug}/tech-log`);
  revalidatePath(`/${groupSlug}`);
  return { success: true };
}
