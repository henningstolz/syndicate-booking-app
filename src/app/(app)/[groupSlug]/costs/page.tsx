import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { londonDateKey } from "@/lib/datetime";
import { formatMonthKey } from "@/lib/flight-times";
import {
  formatHoursTenths,
  formatMoney,
  shiftMonth,
  type CostStatement,
} from "@/lib/costs";
import { addCostItem, saveCostRate, voidCostItem } from "./actions";

type RateRow = {
  id: string;
  effective_month: string;
  monthly_fee_pence: number;
  hourly_rate_pence: number;
};

type ItemRow = {
  id: string;
  incurred_on: string;
  category: string;
  description: string;
  amount_pence: number;
  voided_at: string | null;
  void_reason: string | null;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  rate_saved: { ok: true, text: "Rates saved from the month you chose." },
  item_added: { ok: true, text: "Cost added." },
  item_voided: { ok: true, text: "Cost voided. It no longer counts." },
  demo: { ok: false, text: "This is a demo, so changes to costs aren't saved." },
  amount_invalid: { ok: false, text: "Please enter an amount in pounds, such as 12.50." },
  month_invalid: { ok: false, text: "That month isn't valid." },
  description_required: { ok: false, text: "Please describe the cost." },
  description_too_long: { ok: false, text: "That description is too long (120 characters at most)." },
  category_invalid: { ok: false, text: "Please choose fuel or other." },
  date_invalid: { ok: false, text: "That date isn't valid (a cost can't be dated in the future)." },
  reason_required: { ok: false, text: "Please give a reason (at least 3 characters)." },
  reason_too_long: { ok: false, text: "That reason is too long (300 characters at most)." },
  already_voided: { ok: false, text: "That cost was already voided." },
  not_found: { ok: false, text: "That cost no longer exists." },
  not_allowed: { ok: false, text: "Only admins can change the costs." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", // a plain calendar date
  weekday: "short",
  day: "numeric",
  month: "short",
});
const shortDay = (date: string) => dayFormat.format(new Date(`${date.slice(0, 10)}T00:00:00Z`));

const card = "rounded-lg border border-zinc-200 bg-white";
const sectionTitle = "text-sm font-medium text-zinc-500";
const inputClass = "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900";
const labelClass = "flex flex-col gap-1 text-xs text-zinc-600";
const primaryButton =
  "rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700";
const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100";
const navLink =
  "rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100";

const pounds = (pence: number) => (pence / 100).toFixed(2);

export default async function CostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ month?: string; notice?: string }>;
}) {
  const { groupSlug } = await params;
  const { month: monthParam, notice: noticeCode } = await searchParams;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = londonDateKey(new Date());
  const thisMonth = today.slice(0, 7);
  const monthKey = monthParam && MONTH.test(monthParam) ? monthParam : thisMonth;
  const notice = noticeCode ? NOTICES[noticeCode] : undefined;

  const { data: raw } = await supabase.rpc("cost_statement", {
    p_group_id: group.id,
    p_month: `${monthKey}-01`,
  });
  const statement = raw as CostStatement | { result: string } | null;

  const monthNav = (
    <nav aria-label="Month" className="flex items-center justify-between gap-2">
      <Link href={`/${groupSlug}/costs?month=${shiftMonth(monthKey, -1)}`} className={navLink}>
        ← Prev
      </Link>
      <h1 className="text-base font-semibold text-zinc-900">{formatMonthKey(monthKey)}</h1>
      {monthKey < thisMonth ? (
        <Link href={`/${groupSlug}/costs?month=${shiftMonth(monthKey, 1)}`} className={navLink}>
          Next →
        </Link>
      ) : (
        <span className="w-[70px]" aria-hidden="true" />
      )}
    </nav>
  );

  const noticeBlock = notice && (
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
  );

  if (!statement || statement.result !== "ok") {
    return (
      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        {noticeBlock}
        {monthNav}
        <p className="text-sm text-zinc-600">The statement could not be worked out for this month.</p>
      </main>
    );
  }

  const s = statement as CostStatement;
  const me = s.members.find((member) => member.user_id === user?.id);
  const mine = s.flights.filter((flight) => flight.user_id === user?.id);
  const hidden = (
    <>
      <input type="hidden" name="groupId" value={group.id} />
      <input type="hidden" name="groupSlug" value={groupSlug} />
      <input type="hidden" name="view" value={monthKey} />
    </>
  );

  // ----------------------------------------------------------- admin extras
  let rates: RateRow[] = [];
  let items: ItemRow[] = [];
  if (s.is_admin) {
    const nextMonth = shiftMonth(monthKey, 1);
    const [ratesResult, itemsResult] = await Promise.all([
      supabase
        .from("cost_rates")
        .select("id, effective_month, monthly_fee_pence, hourly_rate_pence")
        .eq("group_id", group.id)
        .order("effective_month", { ascending: false })
        .order("created_at", { ascending: false })
        .returns<RateRow[]>(),
      supabase
        .from("cost_items")
        .select("id, incurred_on, category, description, amount_pence, voided_at, void_reason")
        .eq("group_id", group.id)
        .gte("incurred_on", `${monthKey}-01`)
        .lt("incurred_on", `${nextMonth}-01`)
        .order("incurred_on", { ascending: false })
        .returns<ItemRow[]>(),
    ]);
    rates = ratesResult.data ?? [];
    items = itemsResult.data ?? [];
  }

  // The months a new rate can start from: two years back to three months ahead.
  const rateMonths = Array.from({ length: 28 }, (_, i) => shiftMonth(thisMonth, 3 - i));
  const sum = (pick: (m: CostStatement["members"][number]) => number) =>
    s.members.reduce((total, member) => total + pick(member), 0);

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-6">
      {noticeBlock}
      {monthNav}

      {s.rates.missing && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {s.is_admin
            ? "No rates are set for this month yet, so only the hours are shown. Set the monthly share and the hourly rate below."
            : "No rates are set for this month yet, so only your hours are shown. An admin can set them."}
        </p>
      )}

      {/* ---------------------------------------------------- your statement */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Your statement</h2>
        <div className={`${card} flex flex-col gap-3 p-4`}>
          {!me ? (
            <p className="text-sm text-zinc-600">
              You weren&apos;t a member in {formatMonthKey(monthKey)} and no flights were charged to you.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-zinc-700">Fixed monthly share</span>
                <span className="font-mono text-zinc-900">{formatMoney(me.fixed_pence)}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-zinc-700">
                    Flying: {formatHoursTenths(me.hours_tenths)} block hours at{" "}
                    {formatMoney(s.rates.hourly_pence)} an hour
                  </span>
                  <span className="font-mono text-zinc-900">{formatMoney(me.hourly_pence)}</span>
                </div>
                {mine.length > 0 && (
                  <ul className="flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-3">
                    {mine.map((flight) => (
                      <li key={flight.id} className="flex items-baseline justify-between gap-3 text-xs text-zinc-500">
                        <span>
                          {shortDay(flight.date)} · {flight.from} → {flight.to} ·{" "}
                          {formatHoursTenths(flight.hours_tenths)} h
                        </span>
                        <span className="font-mono">{formatMoney(flight.pence)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-zinc-700">Fuel and shared costs</span>
                  <span className="font-mono text-zinc-900">{formatMoney(me.fuel_pence)}</span>
                </div>
                <p className="text-xs text-zinc-500">
                  {s.fuel_pence === 0
                    ? "Nothing to share this month."
                    : s.hours_tenths > 0
                      ? `Your share of ${formatMoney(s.fuel_pence)}, by hours flown: ${formatHoursTenths(me.hours_tenths)} of ${formatHoursTenths(s.hours_tenths)} hours.`
                      : `${formatMoney(s.fuel_pence)} shared equally, as nobody flew this month.`}
                </p>
              </div>

              <div className="flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-3">
                <span className="text-sm font-semibold text-zinc-900">Total for {formatMonthKey(monthKey)}</span>
                <span className="font-mono text-lg font-semibold text-zinc-900">{formatMoney(me.total_pence)}</span>
              </div>
            </>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Block time runs from brakes off to brakes on, as in the tech log. A guest&apos;s flight is charged to
          the member who logged it. This updates as flights and costs are entered.
        </p>
      </section>

      {/* ------------------------------------------------ the group this month */}
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>The group in {formatMonthKey(monthKey)}</h2>
        <div className={`${card} grid grid-cols-2 gap-3 p-4 text-sm`}>
          <div>
            <p className="text-xs text-zinc-500">Block hours flown</p>
            <p className="font-mono text-zinc-900">{formatHoursTenths(s.hours_tenths)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Fuel and shared costs</p>
            <p className="font-mono text-zinc-900">{formatMoney(s.fuel_pence)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Fixed monthly share</p>
            <p className="font-mono text-zinc-900">{formatMoney(s.rates.fee_pence)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Hourly rate</p>
            <p className="font-mono text-zinc-900">{formatMoney(s.rates.hourly_pence)}</p>
          </div>
        </div>
      </section>

      {s.is_admin && (
        <>
          {/* ---------------------------------------------------- everyone */}
          <section className="flex flex-col gap-2">
            <h2 className={sectionTitle}>Everyone, {formatMonthKey(monthKey)}</h2>
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="px-3 py-2 font-medium">Member</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Fixed</th>
                    <th className="px-3 py-2 text-right font-medium">Flying</th>
                    <th className="px-3 py-2 text-right font-medium">Fuel</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-900">
                  {s.members.map((member) => (
                    <tr key={member.user_id} className="border-b border-zinc-100">
                      <td className="px-3 py-2 font-sans">
                        {member.name}
                        {!member.is_member && <span className="text-xs text-zinc-400"> (not a member)</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{formatHoursTenths(member.hours_tenths)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(member.fixed_pence)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(member.hourly_pence)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(member.fuel_pence)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatMoney(member.total_pence)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="font-mono text-zinc-900">
                  <tr className="bg-zinc-50">
                    <td className="px-3 py-2 font-sans font-medium">To collect</td>
                    <td className="px-3 py-2 text-right">{formatHoursTenths(sum((m) => m.hours_tenths))}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(sum((m) => m.fixed_pence))}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(sum((m) => m.hourly_pence))}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(sum((m) => m.fuel_pence))}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(sum((m) => m.total_pence))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ------------------------------------------------------- rates */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Rates</h2>
            <form action={saveCostRate} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
              {hidden}
              <label className={labelClass}>
                Applies from
                <select name="month" defaultValue={`${monthKey}-01`} className={inputClass}>
                  {rateMonths.map((key) => (
                    <option key={key} value={`${key}-01`}>
                      {formatMonthKey(key)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Fixed monthly share (£ each)
                  <input
                    type="text"
                    name="fee"
                    required
                    inputMode="decimal"
                    placeholder="120.00"
                    defaultValue={s.rates.missing ? "" : pounds(s.rates.fee_pence)}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Hourly rate (£ per block hour)
                  <input
                    type="text"
                    name="hourly"
                    required
                    inputMode="decimal"
                    placeholder="65.00"
                    defaultValue={s.rates.missing ? "" : pounds(s.rates.hourly_pence)}
                    className={inputClass}
                  />
                </label>
              </div>
              <button type="submit" className={`${primaryButton} self-start`}>
                Save rates
              </button>
              <p className="text-xs text-zinc-500">
                They apply from the month you choose until you set new ones. Earlier months keep the rates they had,
                so raising the rate never changes a past statement.
              </p>
            </form>

            {rates.length > 0 && (
              <ul className="flex max-w-md flex-col gap-1 text-xs text-zinc-600">
                {rates.map((rate) => (
                  <li key={rate.id} className="flex items-baseline justify-between gap-3">
                    <span>From {formatMonthKey(rate.effective_month.slice(0, 7))}</span>
                    <span className="font-mono">
                      {formatMoney(rate.monthly_fee_pence)} a month · {formatMoney(rate.hourly_rate_pence)} an hour
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------------------------ shared costs */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Fuel and shared costs, {formatMonthKey(monthKey)}</h2>
            <form action={addCostItem} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
              {hidden}
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Date
                  <input type="date" name="date" required max={today} defaultValue={today} className={inputClass} />
                </label>
                <label className={labelClass}>
                  Kind
                  <select name="category" defaultValue="fuel" className={inputClass}>
                    <option value="fuel">Fuel</option>
                    <option value="other">Other (shared by hours)</option>
                  </select>
                </label>
              </div>
              <label className={labelClass}>
                What it was
                <input type="text" name="description" required maxLength={120} placeholder="Fuel, self-serve pump" className={inputClass} />
              </label>
              <label className={labelClass}>
                Amount (£)
                <input type="text" name="amount" required inputMode="decimal" placeholder="625.00" className={inputClass} />
              </label>
              <button type="submit" className={`${primaryButton} self-start`}>
                Add cost
              </button>
              <p className="text-xs text-zinc-500">
                Shared between members by the hours they flew in the month the cost is dated. A cost can&apos;t be
                edited; if one is wrong, void it with a reason and enter it again.
              </p>
            </form>

            {items.length === 0 ? (
              <p className="text-sm text-zinc-500">No costs entered for this month.</p>
            ) : (
              <div className="flex max-w-md flex-col gap-2">
                {items.map((item) => (
                  <article key={item.id} className={`${card} flex flex-col gap-1 px-3 py-2 ${item.voided_at ? "opacity-60" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={`text-sm text-zinc-900 ${item.voided_at ? "line-through" : ""}`}>
                        {item.description}
                      </p>
                      <p className={`font-mono text-sm text-zinc-900 ${item.voided_at ? "line-through" : ""}`}>
                        {formatMoney(item.amount_pence)}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {shortDay(item.incurred_on)} · {item.category === "fuel" ? "Fuel" : "Other"}
                      {item.voided_at && ` · Voided: ${item.void_reason}`}
                    </p>
                    {!item.voided_at && (
                      <details className="text-xs text-zinc-600">
                        <summary className="w-fit text-zinc-500 underline underline-offset-4">Void this cost</summary>
                        <form action={voidCostItem} className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="groupSlug" value={groupSlug} />
                          <input type="hidden" name="view" value={monthKey} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input
                            type="text"
                            name="reason"
                            required
                            minLength={3}
                            maxLength={300}
                            placeholder="Reason, e.g. entered twice"
                            className="rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900"
                          />
                          <button type="submit" className={`${smallButton} w-fit`}>
                            Void cost
                          </button>
                        </form>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
