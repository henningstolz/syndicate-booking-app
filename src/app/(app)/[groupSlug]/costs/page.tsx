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
import {
  addCostExpense,
  closeCostMonth,
  previewStatementEmail,
  recordCostPayment,
  reopenCostMonth,
  saveCostRate,
  saveMemberCostRate,
  voidCostExpense,
  voidCostPayment,
} from "./actions";

type RateRow = {
  id: string;
  user_id: string | null;
  effective_month: string;
  monthly_fee_pence: number | null;
  hourly_rate_pence: number | null;
};

type ExpenseRow = {
  id: string;
  paid_by: string;
  incurred_on: string;
  description: string;
  amount_pence: number;
  voided_at: string | null;
  void_reason: string | null;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  rate_saved: { ok: true, text: "Rates saved from the month you chose." },
  member_rate_saved: { ok: true, text: "The member's own rates are saved from the month you chose." },
  month_closed_done: { ok: true, text: "Month closed. Its figures are saved and no longer change." },
  month_closed_emailed: { ok: true, text: "Month closed. Statements are being emailed to the members who have that email switched on." },
  preview_sent: { ok: true, text: "A preview was sent to your own email address. Nothing was sent to members." },
  no_statement: { ok: false, text: "You have no statement for that month, so there is nothing to preview." },
  no_email: { ok: false, text: "Your account has no email address to send the preview to." },
  payment_recorded: { ok: true, text: "Payment recorded." },
  payment_voided: { ok: true, text: "Payment voided. It no longer counts." },
  month_not_closed: { ok: false, text: "Payments can only be recorded for a closed month, so the amount is final." },
  month_reopened: { ok: true, text: "Month reopened. It is worked out live again." },
  month_closed: { ok: false, text: "That month is closed. Reopen it first, or date the expense in an open month." },
  month_not_over: { ok: false, text: "Only a finished month can be closed." },
  rates_missing: { ok: false, text: "This month has no rates set, so there is nothing to freeze. Set the rates first." },
  already_closed: { ok: false, text: "That month is already closed." },
  not_closed: { ok: false, text: "That month is not closed." },
  note_too_long: { ok: false, text: "That note is too long (300 characters at most)." },
  expense_added: { ok: true, text: "Expense added. It is credited to the member." },
  expense_voided: { ok: true, text: "Expense voided. It no longer counts." },
  demo: { ok: false, text: "This is a demo, so changes to costs aren't saved." },
  amount_invalid: { ok: false, text: "Please enter an amount in pounds, such as 12.50." },
  month_invalid: { ok: false, text: "That month isn't valid." },
  description_required: { ok: false, text: "Please describe the expense." },
  description_too_long: { ok: false, text: "That description is too long (120 characters at most)." },
  member_invalid: { ok: false, text: "Please choose someone from the list who has a statement for that month." },
  date_invalid: { ok: false, text: "That date isn't valid (it can't be in the future)." },
  reason_required: { ok: false, text: "Please give a reason (at least 3 characters)." },
  reason_too_long: { ok: false, text: "That reason is too long (300 characters at most)." },
  already_voided: { ok: false, text: "That expense was already voided." },
  not_found: { ok: false, text: "That expense no longer exists." },
  not_allowed: { ok: false, text: "Only admins can change the costs." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", // a plain calendar date
  weekday: "short",
  day: "numeric",
  month: "short",
});
const closedFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const closedOn = (timestamp: string) => closedFormat.format(new Date(timestamp));
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
  let expenses: ExpenseRow[] = [];
  if (s.is_admin) {
    const nextMonth = shiftMonth(monthKey, 1);
    const [ratesResult, expensesResult] = await Promise.all([
      supabase
        .from("cost_rates")
        .select("id, user_id, effective_month, monthly_fee_pence, hourly_rate_pence")
        .eq("group_id", group.id)
        .order("effective_month", { ascending: false })
        .order("created_at", { ascending: false })
        .returns<RateRow[]>(),
      supabase
        .from("cost_expenses")
        .select("id, paid_by, incurred_on, description, amount_pence, voided_at, void_reason")
        .eq("group_id", group.id)
        .gte("incurred_on", `${monthKey}-01`)
        .lt("incurred_on", `${nextMonth}-01`)
        .order("incurred_on", { ascending: false })
        .returns<ExpenseRow[]>(),
    ]);
    rates = ratesResult.data ?? [];
    expenses = expensesResult.data ?? [];
  }
  const groupRates = rates.filter((rate) => rate.user_id === null);
  const memberRates = rates.filter((rate) => rate.user_id !== null);
  const nameOf = (userId: string) => s.members.find((member) => member.user_id === userId)?.name ?? "Member";
  const currentMembers = s.members.filter((member) => member.is_member);
  const myExpenses = s.expenses.filter((expense) => expense.user_id === user?.id);

  // The months a new rate can start from: two years back to three months ahead.
  const rateMonths = Array.from({ length: 28 }, (_, i) => shiftMonth(thisMonth, 3 - i));
  type Member = CostStatement["members"][number];
  // Where a member stands for a closed month: what is left to pay, or settled.
  const standing = (m: Member) => {
    if (m.balance_pence > 0) {
      return { text: m.paid_pence !== 0 ? `${formatMoney(m.balance_pence)} left to pay` : `${formatMoney(m.balance_pence)} to pay`, tone: "text-amber-800" };
    }
    if (m.balance_pence < 0) {
      return { text: `${formatMoney(-m.balance_pence)} owed to them`, tone: "text-sky-800" };
    }
    if (m.total_pence === 0 && m.paid_pence === 0) return { text: "", tone: "" };
    return { text: m.total_pence > 0 ? "Paid" : "Settled", tone: "text-green-800" };
  };
  const toCollect = s.members.reduce((total, m) => total + Math.max(m.balance_pence, 0), 0);
  const owedOut = s.members.reduce((total, m) => total + Math.max(-m.balance_pence, 0), 0);
  const myPayments = s.payments.filter((payment) => payment.user_id === user?.id);
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

      {s.closed && (
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-800">
          <p>
            <span className="font-medium">Closed</span> on {closedOn(s.closed.closed_at)} by {s.closed.closed_by_name}.
            These are the saved, final figures for {formatMonthKey(monthKey)}.
          </p>
          {s.closed.note && <p className="text-xs text-zinc-600">Note: {s.closed.note}</p>}
        </div>
      )}

      {s.is_admin && s.closed && s.drift.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Changed since this month was closed</p>
          <p className="text-xs">
            Flights or other changes mean the figures would now be different. The closed figures above did not
            change. Reopen the month below to take the changes in, or settle the difference in an open month.
          </p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {s.drift.map((entry) => (
              <li key={entry.user_id} className="flex items-baseline justify-between gap-3">
                <span>{entry.name}</span>
                <span className="font-mono">
                  {formatMoney(entry.closed_pence)} → {formatMoney(entry.now_pence)} ({formatHoursTenths(entry.closed_tenths)} →{" "}
                  {formatHoursTenths(entry.now_tenths)} h)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------------------------------------------- your statement */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionTitle}>Your statement</h2>
          {me && (
            <a href={`/${groupSlug}/costs/pdf?month=${monthKey}`} className="text-xs text-zinc-600 underline underline-offset-4">
              Download PDF
            </a>
          )}
        </div>
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
                    {formatMoney(me.hourly_rate_pence)} an hour
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

              {me.credit_pence > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-zinc-700">Expenses you paid</span>
                    <span className="font-mono text-zinc-900">{formatMoney(-me.credit_pence)}</span>
                  </div>
                  <ul className="flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-3">
                    {myExpenses.map((expense) => (
                      <li key={expense.id} className="flex items-baseline justify-between gap-3 text-xs text-zinc-500">
                        <span>
                          {shortDay(expense.date)} · {expense.description}
                        </span>
                        <span className="font-mono">{formatMoney(-expense.pence)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-3">
                <span className="text-sm font-semibold text-zinc-900">
                  {me.total_pence < 0 ? `Credit to you for ${formatMonthKey(monthKey)}` : `Total for ${formatMonthKey(monthKey)}`}
                </span>
                <span className="font-mono text-lg font-semibold text-zinc-900">
                  {formatMoney(Math.abs(me.total_pence))}
                </span>
              </div>
              {s.closed && standing(me).text !== "" && (
                <div className="flex flex-col gap-1.5 rounded-md bg-zinc-50 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-zinc-700">Payment</span>
                    <span className={`font-medium ${standing(me).tone}`}>{standing(me).text}</span>
                  </div>
                  {myPayments.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {myPayments.map((payment) => (
                        <li key={payment.id} className="flex items-baseline justify-between gap-3 text-xs text-zinc-500">
                          <span>
                            {payment.amount_pence < 0 ? "Paid back to you" : "Paid"} {shortDay(payment.paid_on)}
                            {payment.note ? ` · ${payment.note}` : ""}
                          </span>
                          <span className="font-mono">{formatMoney(Math.abs(payment.amount_pence))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {me.custom_rates && (
                <p className="text-xs text-zinc-500">
                  Your own rates apply: {formatMoney(me.fee_pence)} a month and {formatMoney(me.hourly_rate_pence)} an hour.
                </p>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Block time runs from brakes off to brakes on, as in the tech log. A guest&apos;s flight is charged to
          the member who logged it. Expenses you paid for the group are taken off your total. {s.closed ? "This month is closed, so these figures no longer change." : "This updates as flights and expenses are entered."}
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
            <p className="text-xs text-zinc-500">Expenses paid by members</p>
            <p className="font-mono text-zinc-900">{formatMoney(s.credits_pence)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Group fixed monthly share</p>
            <p className="font-mono text-zinc-900">{formatMoney(s.rates.fee_pence)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Group hourly rate</p>
            <p className="font-mono text-zinc-900">{formatMoney(s.rates.hourly_pence)}</p>
          </div>
        </div>
      </section>

      {s.is_admin && (
        <>
          {/* ---------------------------------------------------- everyone */}
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionTitle}>Everyone, {formatMonthKey(monthKey)}</h2>
              <a
                href={`/${groupSlug}/costs/pdf?month=${monthKey}&member=all`}
                className="text-xs text-zinc-600 underline underline-offset-4"
              >
                Download everyone (PDF)
              </a>
            </div>
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="px-3 py-2 font-medium">Member</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Fixed</th>
                    <th className="px-3 py-2 text-right font-medium">Flying</th>
                    <th className="px-3 py-2 text-right font-medium">Expenses</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    {s.closed && <th className="px-3 py-2 text-left font-medium">Payment</th>}
                    <th className="px-3 py-2 font-medium"><span className="sr-only">PDF</span></th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-900">
                  {s.members.map((member) => (
                    <tr key={member.user_id} className="border-b border-zinc-100">
                      <td className="px-3 py-2 font-sans">
                        {member.name}
                        {!member.is_member && <span className="text-xs text-zinc-400"> (not a member)</span>}
                        {member.custom_rates && <span className="text-xs text-zinc-400"> (own rates)</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{formatHoursTenths(member.hours_tenths)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(member.fixed_pence)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(member.hourly_pence)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(-member.credit_pence)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatMoney(member.total_pence)}</td>
                      {s.closed && (
                        <td className="px-3 py-2 text-left font-sans text-xs">
                          <span className={`font-medium ${standing(member).tone}`}>{standing(member).text}</span>
                          {member.balance_pence !== 0 && (
                            <form action={recordCostPayment} className="mt-1">
                              {hidden}
                              <input type="hidden" name="memberId" value={member.user_id} />
                              <input type="hidden" name="amountPence" value={member.balance_pence} />
                              <input type="hidden" name="date" value={today} />
                              <button type="submit" className={smallButton}>
                                {member.balance_pence > 0 ? "Mark paid" : "Mark paid back"}
                              </button>
                            </form>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-sans text-xs">
                        <a
                          href={`/${groupSlug}/costs/pdf?month=${monthKey}&member=${member.user_id}`}
                          className="text-zinc-600 underline underline-offset-4"
                          aria-label={`PDF statement for ${member.name}`}
                        >
                          PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="font-mono text-zinc-900">
                  <tr className="bg-zinc-50">
                    <td className="px-3 py-2 font-sans font-medium">Total</td>
                    <td className="px-3 py-2 text-right">{formatHoursTenths(sum((m) => m.hours_tenths))}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(sum((m) => m.fixed_pence))}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(sum((m) => m.hourly_pence))}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(-sum((m) => m.credit_pence))}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(sum((m) => m.total_pence))}</td>
                    {s.closed && <td />}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {s.closed && (
            <p className="-mt-3 max-w-xl text-sm text-zinc-700">
              Still to collect: <span className="font-mono font-medium">{formatMoney(toCollect)}</span>
              {owedOut > 0 && (
                <>
                  {" "}
                  · Owed to members: <span className="font-mono font-medium">{formatMoney(owedOut)}</span>
                </>
              )}
            </p>
          )}

          {/* ----------------------------------------------------- payments */}
          {s.closed && (
            <section className="flex flex-col gap-3">
              <h2 className={sectionTitle}>Payments, {formatMonthKey(monthKey)}</h2>
              <form action={recordCostPayment} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
                {hidden}
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Member
                    <select name="memberId" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        Choose…
                      </option>
                      {s.members.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Direction
                    <select name="direction" defaultValue="in" className={inputClass}>
                      <option value="in">Member paid the group</option>
                      <option value="out">Group paid the member back</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Amount (£)
                    <input type="text" name="amount" required inputMode="decimal" placeholder="185.00" className={inputClass} />
                  </label>
                  <label className={labelClass}>
                    Date received
                    <input type="date" name="date" required max={today} defaultValue={today} className={inputClass} />
                  </label>
                </div>
                <label className={labelClass}>
                  Note (optional)
                  <input type="text" name="note" maxLength={120} placeholder="Bank transfer" className={inputClass} />
                </label>
                <button type="submit" className={`${primaryButton} self-start`}>
                  Record payment
                </button>
                <p className="text-xs text-zinc-500">
                  For when the full amount is paid in one go, use <strong>Mark paid</strong> in the table above. A payment
                  can&apos;t be edited; if one is wrong, void it with a reason and enter it again.
                </p>
              </form>

              {s.payments.length === 0 ? (
                <p className="text-sm text-zinc-500">No payments recorded for this month yet.</p>
              ) : (
                <div className="flex max-w-md flex-col gap-2">
                  {s.payments.map((payment) => (
                    <article key={payment.id} className={`${card} flex flex-col gap-1 px-3 py-2`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm text-zinc-900">{nameOf(payment.user_id)}</p>
                        <p className="font-mono text-sm text-zinc-900">
                          {payment.amount_pence < 0 ? "-" : ""}
                          {formatMoney(Math.abs(payment.amount_pence))}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {payment.amount_pence < 0 ? "Paid back" : "Received"} {shortDay(payment.paid_on)}
                        {payment.note ? ` · ${payment.note}` : ""}
                      </p>
                      <details className="text-xs text-zinc-600">
                        <summary className="w-fit text-zinc-500 underline underline-offset-4">Void this payment</summary>
                        <form action={voidCostPayment} className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="groupSlug" value={groupSlug} />
                          <input type="hidden" name="view" value={monthKey} />
                          <input type="hidden" name="paymentId" value={payment.id} />
                          <input
                            type="text"
                            name="reason"
                            required
                            minLength={3}
                            maxLength={300}
                            placeholder="Reason, e.g. entered on the wrong member"
                            className="rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900"
                          />
                          <button type="submit" className={`${smallButton} w-fit`}>
                            Void payment
                          </button>
                        </form>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* --------------------------------------------- close or reopen */}
          {(s.can_close || s.closed) && (
            <section className="flex flex-col gap-3">
              <h2 className={sectionTitle}>
                {s.closed ? "Reopen" : "Close"} {formatMonthKey(monthKey)}
              </h2>
              {s.closed ? (
                <form action={reopenCostMonth} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
                  {hidden}
                  <label className={labelClass}>
                    Reason
                    <input
                      type="text"
                      name="reason"
                      required
                      minLength={3}
                      maxLength={300}
                      placeholder="e.g. a flight was logged late"
                      className={inputClass}
                    />
                  </label>
                  <button type="submit" className={`${smallButton} self-start`}>
                    Reopen this month
                  </button>
                  <p className="text-xs text-zinc-500">
                    The month is worked out live again, so it takes in any changes since closing. The earlier closing
                    stays on record, and you can close the month again afterwards.
                  </p>
                </form>
              ) : (
                <form action={closeCostMonth} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
                  {hidden}
                  <label className={labelClass}>
                    Note (optional)
                    <input type="text" name="note" maxLength={300} placeholder="e.g. checked with the group" className={inputClass} />
                  </label>
                  <label className="flex items-start gap-2 text-sm text-zinc-700">
                    <input type="checkbox" name="notify" defaultChecked className="mt-1" />
                    <span>
                      Email each member their statement, with the PDF attached
                      <span className="block text-xs text-zinc-500">
                        Each member only receives their own. Members can switch these emails off in Settings.
                      </span>
                    </span>
                  </label>
                  <button type="submit" className={`${primaryButton} self-start`}>
                    Close {formatMonthKey(monthKey)}
                  </button>
                  <p className="text-xs text-zinc-500">
                    Saves everyone&apos;s statement exactly as it is now. Later flights, new rates or new entries can no
                    longer change it, and no expense can be added to the month. You can reopen it with a reason.
                  </p>
                </form>
              )}
            </section>
          )}

          {/* ------------------------------------------- preview my statement */}
          {me && (
            <section className="flex flex-col gap-2">
              <h2 className={sectionTitle}>Check the statement email</h2>
              <form action={previewStatementEmail} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
                {hidden}
                <button type="submit" className={`${smallButton} self-start`}>
                  Email me my {formatMonthKey(monthKey)} statement
                </button>
                <p className="text-xs text-zinc-500">
                  Sends the statement email, with its PDF, to you only, so you can see what members receive. Nobody
                  else is emailed, and nothing is closed.
                </p>
              </form>
            </section>
          )}

          {/* ------------------------------------------------------- rates */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Group rates</h2>
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
                The default for every member. They apply from the month you choose until you set new ones. Earlier
                months keep the rates they had, so raising the rate never changes a past statement.
              </p>
            </form>

            {groupRates.length > 0 && (
              <ul className="flex max-w-md flex-col gap-1 text-xs text-zinc-600">
                {groupRates.map((rate) => (
                  <li key={rate.id} className="flex items-baseline justify-between gap-3">
                    <span>From {formatMonthKey(rate.effective_month.slice(0, 7))}</span>
                    <span className="font-mono">
                      {formatMoney(rate.monthly_fee_pence ?? 0)} a month · {formatMoney(rate.hourly_rate_pence ?? 0)} an hour
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ----------------------------------------------- individual rates */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Individual rates</h2>
            <form action={saveMemberCostRate} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
              {hidden}
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Member
                  <select name="memberId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {currentMembers.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Fixed monthly share (£)
                  <input type="text" name="fee" inputMode="decimal" placeholder="group rate" className={inputClass} />
                </label>
                <label className={labelClass}>
                  Hourly rate (£ per block hour)
                  <input type="text" name="hourly" inputMode="decimal" placeholder="group rate" className={inputClass} />
                </label>
              </div>
              <button type="submit" className={`${primaryButton} self-start`}>
                Save individual rates
              </button>
              <p className="text-xs text-zinc-500">
                Leave a box empty to follow the group&apos;s rate; enter 0 for none (for example no fixed share for
                someone who doesn&apos;t own a share). Saving with both boxes empty puts the member back on the
                group&apos;s rates. Members only see their own rates.
              </p>
            </form>

            {memberRates.length > 0 && (
              <ul className="flex max-w-md flex-col gap-1 text-xs text-zinc-600">
                {memberRates.map((rate) => (
                  <li key={rate.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      {nameOf(rate.user_id as string)} · from {formatMonthKey(rate.effective_month.slice(0, 7))}
                    </span>
                    <span className="text-right font-mono">
                      {rate.monthly_fee_pence === null ? "group share" : `${formatMoney(rate.monthly_fee_pence)} a month`}
                      {" · "}
                      {rate.hourly_rate_pence === null ? "group rate" : `${formatMoney(rate.hourly_rate_pence)} an hour`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------------------------------ expenses */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Expenses paid by members, {formatMonthKey(monthKey)}</h2>
            {s.closed ? (
              <p className={`${card} max-w-md p-4 text-sm text-zinc-600`}>
                {formatMonthKey(monthKey)} is closed, so expenses can&apos;t be added to it. Reopen the month below to
                change it, or date the expense in an open month.
              </p>
            ) : (
            <form action={addCostExpense} className={`${card} flex max-w-md flex-col gap-3 p-4`}>
              {hidden}
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Paid by
                  <select name="memberId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {currentMembers.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Date
                  <input type="date" name="date" required max={today} defaultValue={today} className={inputClass} />
                </label>
              </div>
              <label className={labelClass}>
                What it was
                <input type="text" name="description" required maxLength={120} placeholder="Fuel at Sywell" className={inputClass} />
              </label>
              <label className={labelClass}>
                Amount (£)
                <input type="text" name="amount" required inputMode="decimal" placeholder="184.00" className={inputClass} />
              </label>
              <button type="submit" className={`${primaryButton} self-start`}>
                Add expense
              </button>
              <p className="text-xs text-zinc-500">
                For something a member paid for the aircraft out of their own pocket, such as fuel bought at another
                airfield. It is taken off that member&apos;s total for the month of its date, and if it comes to more than
                their bill, the statement shows a credit to them. An expense can&apos;t be edited; if one is wrong,
                void it with a reason and enter it again.
              </p>
            </form>
            )}

            {expenses.length === 0 ? (
              <p className="text-sm text-zinc-500">No expenses entered for this month.</p>
            ) : (
              <div className="flex max-w-md flex-col gap-2">
                {expenses.map((expense) => (
                  <article key={expense.id} className={`${card} flex flex-col gap-1 px-3 py-2 ${expense.voided_at ? "opacity-60" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={`text-sm text-zinc-900 ${expense.voided_at ? "line-through" : ""}`}>
                        {expense.description}
                      </p>
                      <p className={`font-mono text-sm text-zinc-900 ${expense.voided_at ? "line-through" : ""}`}>
                        {formatMoney(expense.amount_pence)}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {shortDay(expense.incurred_on)} · paid by {nameOf(expense.paid_by)}
                      {expense.voided_at && ` · Voided: ${expense.void_reason}`}
                    </p>
                    {!expense.voided_at && !s.closed && (
                      <details className="text-xs text-zinc-600">
                        <summary className="w-fit text-zinc-500 underline underline-offset-4">Void this expense</summary>
                        <form action={voidCostExpense} className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="groupSlug" value={groupSlug} />
                          <input type="hidden" name="view" value={monthKey} />
                          <input type="hidden" name="expenseId" value={expense.id} />
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
                            Void expense
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
