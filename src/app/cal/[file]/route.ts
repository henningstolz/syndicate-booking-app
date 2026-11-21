import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildIcs } from "@/lib/ical";
import { feedCalendarName, feedEvents, feedFileName, type Feed } from "@/lib/calendar-feed";
import { siteUrl } from "@/lib/notify/send";

// The calendar subscription: /cal/<secret>.ics. Calendar apps cannot sign in, so
// the secret in the address is the only credential; the database answers only for
// an active link of a current member (calendar_feed, migrations 0021 and 0030: the
// whole group's bookings, or only the member's own) and returns nothing for anything
// else. Never indexed, never shared-cached.
export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new Response("This calendar link was not found, or it has been turned off.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = /^([0-9a-f]{64})\.ics$/.exec(file);
  if (!match) return NOT_FOUND();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return NOT_FOUND();

  // The plain public key and no session: the secret in the address is the credential.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("calendar_feed", { p_token: match[1] });
  if (error || !data) return NOT_FOUND();
  const feed = data as Feed;

  const body = buildIcs({ name: feedCalendarName(feed), events: feedEvents(feed, siteUrl()) });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${feedFileName(feed)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
