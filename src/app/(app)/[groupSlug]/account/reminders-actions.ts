"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { planReminderChanges, MAX_PERSONAL_REMINDERS } from "@/lib/personal-reminders";

export type RemindersActionState = { error?: string; success?: boolean };

const ORDER = { delete: 0, update: 1, add: 2 } as const;

// Save a person's own reminders (names and dates). Row security lets a person change only their own rows,
// and every statement names the person as well as the reminder.
export async function saveReminders(
  _prev: RemindersActionState,
  formData: FormData,
): Promise<RemindersActionState> {
  if (await isDemoRequest()) {
    return { error: "This is a demo, so reminders can't be changed. Create your own group to try it." };
  }

  const groupSlug = String(formData.get("groupSlug") ?? "");
  const strings = (key: string) => formData.getAll(key).map((v) => String(v));
  const plan = planReminderChanges({
    ids: strings("reminderId"),
    labels: strings("reminderLabel"),
    dues: strings("reminderDue"),
    origLabels: strings("reminderOrigLabel"),
    origDues: strings("reminderOrigDue"),
    deletedIds: strings("reminderDeleted"),
  });
  if ("error" in plan) return { error: plan.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Removals first (so a full list can swap one for another), then changes, then additions.
  for (const change of [...plan.changes].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
    const result =
      change.kind === "delete"
        ? await supabase.from("personal_reminders").delete().eq("id", change.id).eq("user_id", user.id)
        : change.kind === "update"
          ? await supabase
              .from("personal_reminders")
              .update({ label: change.label, due_date: change.due })
              .eq("id", change.id)
              .eq("user_id", user.id)
          : await supabase
              .from("personal_reminders")
              .insert({ user_id: user.id, label: change.label, due_date: change.due });
    if (result.error) {
      return {
        error: result.error.message.includes("personal_reminders_limit")
          ? `You can have at most ${MAX_PERSONAL_REMINDERS} reminders.`
          : "Could not save your reminders.",
      };
    }
  }

  revalidatePath(`/${groupSlug}/account`);
  revalidatePath(`/${groupSlug}`);
  return { success: true };
}
