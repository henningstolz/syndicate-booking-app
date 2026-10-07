import { type NextRequest } from "next/server";
import { flushNotifications } from "@/lib/notify/send";

// Once a day Vercel calls this to send any notification email that was left
// in the queue (for example because the email service was briefly down). It
// is also the way to flush the queue by hand. It only answers to Vercel's
// scheduled call, which carries the CRON_SECRET setting; without that setting
// or with a wrong one it does nothing.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await flushNotifications());
}
