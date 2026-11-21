// What a calendar link's feed holds, worked out from what the database's calendar_feed() returns. Pure and
// import-free (apart from a type), so tests can load it in plain Node. The route src/app/cal/[file]/route.ts
// only fetches and sends it.
import type { IcsEvent } from "./ical.ts";

// The two kinds of link a member can have: the whole group's bookings, or only their own.
export type FeedScope = "all" | "mine";

export function parseFeedScope(value: unknown): FeedScope {
  return value === "mine" ? "mine" : "all";
}

export type FeedBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  who: string;
  mine: boolean;
  created_at: string;
};

export type Feed = {
  scope?: FeedScope; // left out by a database from before migration 0030: the whole group
  group_name: string;
  group_slug: string;
  registration: string;
  bookings: FeedBooking[];
};

// The calendar's name in the calendar app: the two links of one member can sit side by side.
export function feedCalendarName(feed: Feed): string {
  return parseFeedScope(feed.scope) === "mine" ? `${feed.group_name}: my bookings` : `${feed.group_name} bookings`;
}

// The file name offered for the feed.
export function feedFileName(feed: Feed): string {
  const registration = feed.registration.replace(/[^A-Za-z0-9._-]/g, "_");
  return parseFeedScope(feed.scope) === "mine" ? `blocktime-${registration}-mine.ics` : `blocktime-${registration}.ics`;
}

export function feedEvents(feed: Feed, siteBase: string): IcsEvent[] {
  const mineOnly = parseFeedScope(feed.scope) === "mine";
  const link = `${siteBase}/${encodeURIComponent(feed.group_slug)}/calendar?view=list`;
  return feed.bookings.map((booking) => ({
    // The whole-group feed keeps the ids it has always had (so existing subscriptions update in place); the
    // own-bookings feed has its own, so the same booking in two subscribed calendars never clashes.
    uid: mineOnly ? `booking-${booking.id}-mine@blocktime.group` : `booking-${booking.id}@blocktime.group`,
    start: booking.starts_at,
    end: booking.ends_at,
    summary: mineOnly ? `${feed.registration} booking` : `${feed.registration}: ${booking.mine ? "You" : booking.who}`,
    description: [
      booking.mine ? `Your booking of ${feed.registration}` : `${booking.who}'s booking of ${feed.registration}`,
      booking.note ? `Note: ${booking.note}` : "",
      `Open in Blocktime: ${link}`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: link,
    stamp: booking.created_at,
  }));
}
