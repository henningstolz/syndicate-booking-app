"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The chat's messages live in the `squawks` table (its original name; the
// table keeps it, only the screens say "Chat").

export type ChatActionState = { error?: string; success?: boolean };

export async function postChatMessage(
  _prevState: ChatActionState,
  formData: FormData,
): Promise<ChatActionState> {
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

  revalidatePath(`/${groupSlug}/chat`);
  return { success: true };
}
