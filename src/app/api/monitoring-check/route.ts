import { type NextRequest } from "next/server";

// For testing the error monitoring: throws an error on purpose, so you can see it arrive
// in Sentry (and see that nothing personal is in it). Like the daily jobs it only answers
// when the request carries the CRON_SECRET setting; otherwise it does nothing.
// Use: curl -H "Authorization: Bearer $CRON_SECRET" https://blocktime.group/api/monitoring-check
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  throw new Error("Monitoring check: this error was thrown on purpose");
}
