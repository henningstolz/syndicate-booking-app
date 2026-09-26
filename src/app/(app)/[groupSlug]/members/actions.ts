"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createInvite(formData: FormData) {
  const groupId = formData.get("groupId") as string;
  const groupSlug = formData.get("groupSlug") as string;
  const role = formData.get("role") as string;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS restricts this to group admins; a non-admin submission
  // (shouldn't happen, the buttons are admin-only) simply inserts
  // zero rows rather than erroring.
  await supabase.from("invites").insert({
    group_id: groupId,
    role,
    created_by: user.id,
  });

  revalidatePath(`/${groupSlug}/members`);
}
