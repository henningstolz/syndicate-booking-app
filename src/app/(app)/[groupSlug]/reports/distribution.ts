import type { createClient } from "@/lib/supabase/server";
import {
  bookingDayKeys,
  londonDateKey,
  londonWallTimeToUtc,
} from "@/lib/datetime";
import type { Slice } from "./DistributionChart";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type MemberRef = { user_id: string; display_name: string | null };
type Row = { member_id: string; starts_at: string; ends_at: string };

export type Metric = "bookings" | "days";

// More segments than this stop being readable as a ring, so the tail
// is folded into a single "Other" bucket.
const MAX_SLICES = 6;
// PostgREST caps a single response (1000 rows by default), so a long
// history has to be read in pages or it would be silently truncated.
const PAGE_SIZE = 1000;

// First and last calendar year that have a confirmed booking, to offer
// only the years that can actually show something.
export async function bookingYearRange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
): Promise<{ first: number; last: number } | null> {
  const edge = (ascending: boolean) =>
    supabase
      .from("bookings")
      .select("starts_at")
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      .order("starts_at", { ascending })
      .limit(1)
      .returns<{ starts_at: string }[]>();

  const [{ data: first }, { data: last }] = await Promise.all([
    edge(true),
    edge(false),
  ]);
  if (!first?.[0] || !last?.[0]) return null;

  const yearOf = (iso: string) =>
    Number(londonDateKey(new Date(iso)).slice(0, 4));
  return { first: yearOf(first[0].starts_at), last: yearOf(last[0].starts_at) };
}

// `year` null means all time.
export async function loadDistribution(
  supabase: Supabase,
  groupId: string,
  members: MemberRef[],
  metric: Metric,
  year: number | null,
): Promise<Slice[]> {
  const range =
    year === null ? null : { start: `${year}-01-01`, end: `${year}-12-31` };

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("bookings")
      .select("member_id, starts_at, ends_at")
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      // id breaks ties so pages never skip or repeat a row.
      .order("starts_at")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (year !== null) {
      // Anything overlapping the year; what actually counts is decided
      // per metric below.
      query = query
        .gte("ends_at", londonWallTimeToUtc(`${year}-01-01`, "00:00").toISOString())
        .lt("starts_at", londonWallTimeToUtc(`${year + 1}-01-01`, "00:00").toISOString());
    }

    const { data } = await query.returns<Row[]>();
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    let value: number;
    if (metric === "days") {
      // Calendar days the booking touches, clipped to the period so a
      // booking straddling New Year only counts the days inside it.
      const days = bookingDayKeys(row.starts_at, row.ends_at);
      value = range
        ? days.filter((d) => d >= range.start && d <= range.end).length
        : days.length;
    } else {
      // A booking counts once, in the period it starts in.
      const startDay = londonDateKey(new Date(row.starts_at));
      value =
        !range || (startDay >= range.start && startDay <= range.end) ? 1 : 0;
    }
    if (value > 0) {
      totals.set(row.member_id, (totals.get(row.member_id) ?? 0) + value);
    }
  }

  const byMember: Slice[] = [...totals.entries()]
    .map(([memberId, count]) => {
      const index = members.findIndex((m) => m.user_id === memberId);
      return {
        key: memberId,
        label: (index >= 0 ? members[index].display_name : null) ?? "Member",
        count,
        colorIndex: index >= 0 ? index : 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  if (byMember.length <= MAX_SLICES) return byMember;

  const rest = byMember.slice(MAX_SLICES - 1);
  return [
    ...byMember.slice(0, MAX_SLICES - 1),
    {
      key: "other",
      label: `Other (${rest.length} members)`,
      count: rest.reduce((sum, s) => sum + s.count, 0),
      colorIndex: null,
    },
  ];
}
