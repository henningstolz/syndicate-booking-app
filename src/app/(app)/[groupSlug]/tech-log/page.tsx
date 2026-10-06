import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { LONDON_TZ, londonDateKey } from "@/lib/datetime";
import { hoursStatus } from "@/lib/aircraft-status";
import { formatMonthKey, monthKeysDescending } from "@/lib/flight-times";
import { FlightEntryCard, type FlightRow } from "./FlightEntryCard";
import { FlightForm } from "./FlightForm";

type MemberRow = {
  user_id: string;
  display_name: string | null;
  role: string;
  removed_at: string | null;
};

const PAGE_SIZE = 40;

const VOID_NOTICES: Record<string, { ok: boolean; text: string }> = {
  voided: { ok: true, text: "Entry voided. It no longer counts towards the hours." },
  reason_required: { ok: false, text: "Please give a reason (at least 3 characters)." },
  reason_too_long: { ok: false, text: "That reason is too long (300 characters at most)." },
  not_allowed: { ok: false, text: "Only admins can void an entry." },
  already_voided: { ok: false, text: "That entry was already voided." },
  not_found: { ok: false, text: "That entry no longer exists." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  month: "long",
  year: "numeric",
});

const dueDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const round1 = (value: number) => Math.round(value * 10) / 10;

const HOURS_STYLES = {
  overdue: "border-red-300 bg-red-50 text-red-700",
  soon: "border-amber-300 bg-amber-50 text-amber-700",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-700",
  unset: "border-zinc-200 bg-zinc-50 text-zinc-500",
} as const;

export default async function TechLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ n?: string; notice?: string }>;
}) {
  const { groupSlug } = await params;
  const { n, notice: noticeCode } = await searchParams;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const limit = Math.min(
    Math.max(Number.parseInt(n ?? "", 10) || PAGE_SIZE, PAGE_SIZE),
    1000,
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, display_name, role, removed_at")
    .eq("group_id", group.id)
    .order("created_at")
    .returns<MemberRow[]>();

  const memberList = members ?? [];
  const memberIndex = new Map(memberList.map((m, i) => [m.user_id, i]));
  const memberName = (userId: string) =>
    memberList.find((m) => m.user_id === userId)?.display_name ?? "Member";
  const activeMembers = memberList.filter((m) => !m.removed_at);
  const me = activeMembers.find((m) => m.user_id === user?.id);
  const isAdmin = me?.role === "admin";

  // ------------------------------------------------------- flight log
  const { data: flights } = await supabase
    .from("flight_entries")
    .select(
      "id, from_place, to_place, flight_category, captain_id, captain_name, created_by, fuel_left_usg, fuel_right_usg, oil_qt, brakes_off, airborne, landed, brakes_on, block_minutes, flight_minutes, block_deci, flight_deci, check_limit_hours, defects, voided_at, void_reason",
    )
    .eq("group_id", group.id)
    .order("brakes_off", { ascending: false })
    .limit(limit)
    .returns<FlightRow[]>();

  const entries = flights ?? [];

  // Months to offer for the PDF: from the first flight's month to this one.
  const { data: firstFlight } = await supabase
    .from("flight_entries")
    .select("flight_date")
    .eq("group_id", group.id)
    .order("flight_date", { ascending: true })
    .limit(1)
    .maybeSingle<{ flight_date: string }>();
  const thisMonth = londonDateKey(new Date()).slice(0, 7);
  const pdfMonths = monthKeysDescending(
    firstFlight?.flight_date.slice(0, 7) ?? thisMonth,
    thisMonth,
  );
  const notice = noticeCode ? VOID_NOTICES[noticeCode] : undefined;

  // The airframe total after each flight, worked backwards from today's
  // total (so a window of the newest entries is enough). Voided entries do
  // not count.
  const total = group.airframe_total_hours;
  const checkAt = group.next_check_at_hours;
  let running = total;
  const afterEach = new Map<string, { total: number; toCheck: number | null }>();
  for (const entry of entries) {
    if (entry.voided_at || running === null) continue;
    afterEach.set(entry.id, {
      total: round1(running),
      // Against the limit that applied when the flight was logged, so old
      // entries stay right after a check resets the limit.
      toCheck:
        entry.check_limit_hours === null
          ? null
          : round1(Number(entry.check_limit_hours) - running),
    });
    running = round1(running - entry.flight_deci);
  }

  const toCheck = group.hours_to_next_check;
  const toCheckStatus = hoursStatus(toCheck === null ? null : Number(toCheck));
  const nextCheckDue = group.next_check_due;

  // Group by the UK month of brakes off, newest first.
  const months: { key: string; label: string; rows: FlightRow[] }[] = [];
  for (const entry of entries) {
    const when = new Date(entry.brakes_off);
    const key = londonDateKey(when).slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) last.rows.push(entry);
    else months.push({ key, label: monthFormat.format(when), rows: [entry] });
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      {notice && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.text}
        </p>
      )}

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
          <p className="text-xs text-zinc-500">Airframe total hours</p>
          <p className="font-mono text-lg text-zinc-900">
            {total === null ? "Not set" : total.toFixed(1)}
          </p>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${HOURS_STYLES[toCheckStatus]}`}>
          <p className="text-xs">Hours to next check</p>
          <p className="font-mono text-lg">
            {toCheck === null ? "Not set" : Number(toCheck).toFixed(1)}
          </p>
          {(checkAt !== null || nextCheckDue) && (
            <p className="text-xs">
              {checkAt !== null && `at ${checkAt.toFixed(1)} h`}
              {checkAt !== null && nextCheckDue && " · "}
              {nextCheckDue &&
                `or by ${dueDateFormat.format(new Date(`${nextCheckDue}T00:00:00Z`))}`}
            </p>
          )}
        </div>
      </section>

      {total === null && (
        <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-600">
          The totals are not set up yet.{" "}
          {isAdmin ? (
            <>
              Enter the airframe&apos;s current total hours and the next
              check&apos;s hours on the{" "}
              <Link
                href={`/${groupSlug}/aircraft`}
                className="text-zinc-900 underline underline-offset-4"
              >
                Aircraft page
              </Link>{" "}
              (Edit), and every entry below will keep them up to date.
            </>
          ) : (
            "An admin can set them on the Aircraft page."
          )}
        </p>
      )}

      {user && (
        <FlightForm
          groupId={group.id}
          groupSlug={groupSlug}
          defaultDate={londonDateKey(new Date())}
          members={activeMembers}
          myUserId={user.id}
        />
      )}

      <details className="text-sm text-zinc-600">
        <summary className="w-fit text-zinc-500 underline underline-offset-4">
          Monthly PDF
        </summary>
        <form
          method="get"
          action={`/${groupSlug}/tech-log/pdf`}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Month
            <select
              name="month"
              defaultValue={thisMonth}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900"
            >
              {pdfMonths.map((key) => (
                <option key={key} value={key}>
                  {formatMonthKey(key)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Download PDF
          </button>
          <p className="basis-full text-xs text-zinc-500">
            A4 landscape, laid out like the paper log, to print for the folder.
          </p>
        </form>
      </details>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">No flights logged yet.</p>
      ) : (
        months.map((month) => (
          <section key={month.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-zinc-500">{month.label}</h2>
            {month.rows.map((entry) => {
              const loggedByOther =
                entry.captain_id !== entry.created_by &&
                memberList.some((m) => m.user_id === entry.created_by);
              const colorIndex = entry.captain_id
                ? (memberIndex.get(entry.captain_id) ?? 0)
                : 0;
              return (
                <FlightEntryCard
                  key={entry.id}
                  entry={entry}
                  groupSlug={groupSlug}
                  isAdmin={isAdmin}
                  totals={afterEach.get(entry.id)}
                  borderClass={
                    entry.captain_id ? memberColor(colorIndex).border : "border-zinc-300"
                  }
                  loggedBy={loggedByOther ? memberName(entry.created_by) : null}
                />
              );
            })}
          </section>
        ))
      )}

      {entries.length === limit && limit < 1000 && (
        <Link
          href={`/${groupSlug}/tech-log?n=${limit + PAGE_SIZE}`}
          className="self-start rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
        >
          Show earlier entries
        </Link>
      )}
    </main>
  );
}
