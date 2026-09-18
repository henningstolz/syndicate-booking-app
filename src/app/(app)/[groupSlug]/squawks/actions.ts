"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SquawkActionState = { error?: string; success?: boolean };

export async function postSquawk(
  _prevState: SquawkActionState,
  formData: FormData,
): Promise<SquawkActionState> {
  const groupId = formData.get("groupId") as string;
  const groupSlug = formData.get("groupSlug") as string;
  const message = (formData.get("message") as string)?.trim();

  if (!message) {
    return { error: "Message can't be empty." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.from("squawks").insert({
    group_id: groupId,
    author_id: user.id,
    message,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${groupSlug}/squawks`);
  return { success: true };
}
