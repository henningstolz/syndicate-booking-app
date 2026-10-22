"use server";

import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { buildFeedbackEmail, type FeedbackCategory } from "@/lib/feedback-email";
import { notifyConfigured, sendEmail, siteUrl } from "@/lib/notify/send";

// Feedback goes to the address on the website: hello@blocktime.group, which is
// forwarded to the owner's inbox. The member's own address is the reply-to.
const FEEDBACK_TO = "hello@blocktime.group";

const REASONS: Record<string, string> = {
  not_allowed: "Only members of the group can send feedback.",
  category_invalid: "Please choose what kind of message this is.",
  message_required: "Please write a few words first.",
  message_too_long: "That is a bit long. Please keep it under 2000 characters.",
  rate_limited: "You have sent a few messages in the last hour. Please try again a little later.",
};

export type FeedbackResult = { ok: true } | { ok: false; error: string };

export async function sendFeedback(input: {
  groupId: string;
  groupSlug: string;
  category: FeedbackCategory;
  message: string;
  page: string;
  userAgent: string;
}): Promise<FeedbackResult> {
  if (await isDemoRequest()) {
    return { ok: false, error: "This is a demo, so feedback isn't sent. In your own group it goes straight to us." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  // Saved first (and limited to a few an hour); the email follows.
  const { data, error } = await supabase.rpc("submit_feedback", {
    p_group_id: input.groupId,
    p_category: input.category,
    p_message: input.message,
    p_page: input.page,
    p_user_agent: input.userAgent,
  });
  const saved = data as { result?: string; id?: string } | null;
  if (error || !saved?.result) return { ok: false, error: "Something went wrong. Please try again." };
  if (saved.result !== "ok") return { ok: false, error: REASONS[saved.result] ?? "Something went wrong. Please try again." };

  const [{ data: member }, { data: group }] = await Promise.all([
    supabase
      .from("group_members")
      .select("display_name")
      .eq("group_id", input.groupId)
      .eq("user_id", user.id)
      .maybeSingle<{ display_name: string | null }>(),
    supabase.from("groups").select("name, slug").eq("id", input.groupId).maybeSingle<{ name: string; slug: string }>(),
  ]);

  const fallback = `We couldn't send your message by email just now. It is saved, but please also write to ${FEEDBACK_TO}.`;
  if (!notifyConfigured()) return { ok: false, error: fallback };

  const email = buildFeedbackEmail(
    {
      category: input.category,
      message: input.message,
      name: member?.display_name ?? "A member",
      email: user.email ?? "unknown",
      groupName: group?.name ?? "unknown group",
      groupSlug: group?.slug ?? input.groupSlug,
      page: input.page,
      userAgent: input.userAgent,
      sentAt: new Date(),
    },
    siteUrl(),
  );
  const outcome = await sendEmail({ ...email, to: FEEDBACK_TO, replyTo: user.email ?? undefined });
  if (!outcome.ok) return { ok: false, error: fallback };

  await supabase.rpc("mark_feedback_emailed", { p_id: saved.id });
  return { ok: true };
}
