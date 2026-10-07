// The loop that sends queued emails: claim a batch, send each one, report how
// it went. The database, the email service and the clock are passed in, so the
// logic can be tested without any of them.
import { renderNotification, type QueuedNotification, type RenderedEmail } from "./email.ts";

export type OutgoingEmail = RenderedEmail & { to: string; unsubscribeUrl: string };

export type FlushDeps = {
  claim: (limit: number) => Promise<QueuedNotification[]>;
  markSent: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  post: (email: OutgoingEmail) => Promise<{ ok: true } | { ok: false; error: string }>;
  sleep: (ms: number) => Promise<void>;
  siteUrl: string;
};

// The email service allows about two requests a second; stay under it.
const PAUSE_MS = 600;

export async function flushQueue(
  deps: FlushDeps,
  limit = 15,
): Promise<{ sent: number; failed: number }> {
  const batch = await deps.claim(limit);
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (i > 0) await deps.sleep(PAUSE_MS);
    try {
      const email = renderNotification(item, deps.siteUrl);
      const result = await deps.post({
        ...email,
        to: item.recipient_email,
        unsubscribeUrl: `${deps.siteUrl.replace(/\/+$/, "")}/${encodeURIComponent(item.group_slug)}/settings?tab=notifications`,
      });
      if (result.ok) {
        await deps.markSent(item.id);
        sent++;
      } else {
        await deps.markFailed(item.id, result.error);
        failed++;
      }
    } catch (error) {
      // One bad email must not stop the rest; it stays queued for a retry.
      await deps.markFailed(item.id, error instanceof Error ? error.message : "unexpected error").catch(() => {});
      failed++;
    }
  }
  return { sent, failed };
}
