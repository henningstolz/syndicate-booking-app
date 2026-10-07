import { type NextRequest } from "next/server";
import { flushNotifications, queueReminders } from "@/lib/notify/send";

// Once a day (in the evening, UK time) Vercel calls this: queue the reminders
// that are due (bookings tomorrow, aircraft dates and hours) and send them, plus
// anything else still waiting. Like the other daily job it only answers to
// Vercel's scheduled call, which carries the CRON_SECRET setting.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const queued = await queueReminders();
  const flushed = await flushNotifications();
  return Response.json({ queued, flushed });
}
