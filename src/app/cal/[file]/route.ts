import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildIcs, type IcsEvent } from "@/lib/ical";
import { siteUrl } from "@/lib/notify/send";

// The calendar subscription: /cal/<secret>.ics. Calendar apps cannot sign in, so
// the secret in the address is the only credential; the database answers only for
// an active link of a current member (calendar_feed, migration 0021) and returns
// nothing for anything else. Never indexed, never shared-cached.
export const dynamic = "force-dynamic";

type FeedBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  who: string;
  mine: boolean;
  created_at: string;
};

type Feed = {
  group_name: string;
  group_slug: string;
  registration: string;
  bookings: FeedBooking[];
};

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

  const base = siteUrl();
  const events: IcsEvent[] = feed.bookings.map((booking) => ({
    uid: `booking-${booking.id}@blocktime.group`,
    start: booking.starts_at,
    end: booking.ends_at,
    summary: `${feed.registration}: ${booking.mine ? "You" : booking.who}`,
    description: [
      booking.mine ? `Your booking of ${feed.registration}` : `${booking.who}'s booking of ${feed.registration}`,
      booking.note ? `Note: ${booking.note}` : "",
      `Open in Blocktime: ${base}/${encodeURIComponent(feed.group_slug)}/calendar?view=list`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: `${base}/${encodeURIComponent(feed.group_slug)}/calendar?view=list`,
    stamp: booking.created_at,
  }));

  const body = buildIcs({ name: `${feed.group_name} bookings`, events });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="blocktime-${feed.registration.replace(/[^A-Za-z0-9._-]/g, "_")}.ics"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
