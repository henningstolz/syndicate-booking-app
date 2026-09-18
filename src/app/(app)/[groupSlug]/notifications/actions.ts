"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type StatusActionState = { error?: string; success?: boolean };

export async function updateAircraftStatus(
  _prevState: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const groupId = formData.get("groupId") as string;
  const groupSlug = formData.get("groupSlug") as string;

  const annualRenewalDue = (formData.get("annualRenewalDue") as string) || null;
  const insuranceRenewalDue =
    (formData.get("insuranceRenewalDue") as string) || null;
  const nextCheckDue = (formData.get("nextCheckDue") as string) || null;
  const hoursToNextCheckRaw = formData.get("hoursToNextCheck") as string;
  const hoursToNextCheck = hoursToNextCheckRaw
    ? Number(hoursToNextCheckRaw)
    : null;

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
    .update({
      annual_renewal_due: annualRenewalDue,
      insurance_renewal_due: insuranceRenewalDue,
      next_check_due: nextCheckDue,
      hours_to_next_check: hoursToNextCheck,
    })
    .eq("id", groupId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${groupSlug}/notifications`);
  return { success: true };
}
