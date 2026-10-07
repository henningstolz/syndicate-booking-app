import { after } from "next/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { flushNotifications } from "./send";

// Call at the end of an action that may have queued emails (a booking, a
// cancellation, a chat post, a flight). The emails go out after the page has
// already responded, so nobody waits for them. Anything that fails stays
// queued and is retried by the next action and by the daily job.
export async function flushSoon(): Promise<void> {
  // The demo never queues anything and must not touch the real queue.
  if (await isDemoRequest()) return;
  after(async () => {
    await flushNotifications();
  });
}
