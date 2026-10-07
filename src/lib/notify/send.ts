import { createClient } from "@supabase/supabase-js";
import { flushQueue, type OutgoingEmail } from "./send-core.ts";
import type { QueuedNotification } from "./email.ts";

// Server-side only. Needs these settings (see docs/systems-and-accounts.md):
//   RESEND_API_KEY  a Resend key that may only send, for blocktime.group
//   NOTIFY_TOKEN    the long random secret whose hash is in notification_worker
//   NOTIFY_FROM     optional sender, e.g. "Blocktime <notifications@mail.blocktime.group>"
//   SITE_URL        the site's own address, for the links in the emails
const DEFAULT_FROM = "Blocktime <notifications@mail.blocktime.group>";
const REPLY_TO = "hello@blocktime.group";

export function notifyConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.NOTIFY_TOKEN &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function siteUrl(): string {
  return (process.env.SITE_URL || "https://blocktime.group").replace(/\/+$/, "");
}

// Send one email through Resend. `fetchImpl` is only swapped in by tests.
export async function sendEmail(
  email: OutgoingEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || DEFAULT_FROM,
        to: [email.to],
        reply_to: REPLY_TO,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: { "List-Unsubscribe": `<${email.unsubscribeUrl}>` },
      }),
    });
    if (response.ok) return { ok: true };
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `Resend answered ${response.status} ${detail}`.trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network error" };
  }
}

// Send what is waiting in the queue. Safe to call at any time and from
// several places: the database hands each email to one caller at a time.
export async function flushNotifications(): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (!notifyConfigured()) return { sent: 0, failed: 0, skipped: "not configured" };

  const token = process.env.NOTIFY_TOKEN as string;
  // The plain public key, never the visitor's session: the queue is opened
  // with the secret, not with a login.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    return await flushQueue({
      claim: async (limit) => {
        const { data, error } = await supabase.rpc("claim_notifications", {
          p_token: token,
          p_limit: limit,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as QueuedNotification[];
      },
      markSent: async (id) => {
        await supabase.rpc("mark_notification_sent", { p_token: token, p_id: id });
      },
      markFailed: async (id, error) => {
        await supabase.rpc("mark_notification_failed", { p_token: token, p_id: id, p_error: error });
      },
      post: (email) => sendEmail(email),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      siteUrl: siteUrl(),
    });
  } catch (error) {
    console.error("Sending notifications failed:", error instanceof Error ? error.message : error);
    return { sent: 0, failed: 0, skipped: "error" };
  }
}
