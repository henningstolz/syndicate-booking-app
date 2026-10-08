// Money helpers and the monthly cost statement.
//
// computeStatement() is an exact twin of the database's live calculation
// (cost_statement_live(), migrations 0016 and 0018; cost_statement() adds the
// closed-month handling around it). The database is the real thing; this copy lets the demo
// show believable statements, and a test compares the two on hundreds of random
// months so they cannot drift apart. No imports, so tests can load it in plain
// Node.
//
// The rule: each member pays a FIXED monthly share plus the HOURLY rate for the
// block hours charged to them, minus any EXPENSES they paid for the group out of
// their own pocket. The group sets default rates; a member can have their own
// fixed share and/or hourly rate (a part left empty follows the group's). All
// money is whole pence.

// ---------------------------------------------------------------- money

// 12345 -> "£123.45"
export function formatMoney(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}

// What an admin types -> whole pence, or null if it is not a sensible amount.
// Accepts "12", "12.5", "12.50", "12,50", "£1,234.50" and "1 234,50".
export function parsePounds(input: string): number | null {
  let text = input.trim().replace(/^£/, "").replace(/\s+/g, "");
  if (text === "") return null;
  // A lone comma with one or two digits after it is a decimal comma (12,50);
  // otherwise commas are thousands separators (1,234.50).
  if (/^\d+,\d{1,2}$/.test(text)) {
    text = text.replace(",", ".");
  } else if (text.includes(",")) {
    // Otherwise commas must be proper thousands separators: 1,234 or 1,234.50.
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) return null;
    text = text.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [pounds, fraction = ""] = text.split(".");
  const pence = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(pence) ? pence : null;
}

// 125 tenths -> "12.5"
export function formatHoursTenths(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

// "2026-12" + 1 -> "2027-01"
export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// ------------------------------------------------------------ the statement

export type StatementMember = {
  user_id: string;
  name: string;
  is_member: boolean;
  flights: number;
  hours_tenths: number;
  fee_pence: number; // the fixed share that applies to this person
  hourly_rate_pence: number; // the hourly rate that applies to this person
  custom_rates: boolean; // true if they have rates of their own
  fixed_pence: number;
  hourly_pence: number;
  credit_pence: number; // expenses they paid, taken off their total
  total_pence: number;
};

export type StatementFlight = {
  id: string;
  date: string;
  from: string;
  to: string;
  user_id: string;
  hours_tenths: number;
  pence: number;
};

export type StatementExpense = {
  id: string;
  date: string;
  description: string;
  user_id: string;
  pence: number;
};

// Set when the admin has closed the month: the figures shown are the ones saved
// at that moment, and later changes do not alter them.
export type StatementClosure = {
  id: string;
  closed_at: string;
  closed_by_name: string;
  note: string | null;
};

// For a closed month, shown to admins: someone whose total or hours are no
// longer what was saved (a flight logged late, for example).
export type StatementDrift = {
  user_id: string;
  name: string;
  closed_pence: number;
  now_pence: number;
  closed_tenths: number;
  now_tenths: number;
};

export type CostStatement = {
  result: "ok";
  month: string;
  is_admin: boolean;
  rates: { fee_pence: number; hourly_pence: number; missing: boolean };
  hours_tenths: number;
  credits_pence: number;
  members: StatementMember[];
  flights: StatementFlight[];
  expenses: StatementExpense[];
  closed: StatementClosure | null;
  can_close: boolean; // an admin may close this month now
  drift: StatementDrift[];
};

export type StatementInput = {
  month: string; // "2026-10-01"
  // The group's rates for the month.
  rates: { feePence: number; hourlyPence: number; missing: boolean };
  // Members' own rates in force for the month (null = follow the group's).
  ownRates: { userId: string; feePence: number | null; hourlyPence: number | null }[];
  // Everyone in the group at any point in the month.
  members: { userId: string; name: string }[];
  // The month's flights (not voided), each already charged to a member: the
  // captain, or for a guest captain the member who logged it.
  flights: {
    id: string;
    date: string;
    from: string;
    to: string;
    chargedTo: string;
    chargedName: string;
    tenths: number; // block time in tenths of an hour
    order: string; // anything sortable (the flight's start time)
  }[];
  // The month's expenses (not voided), each with the member who paid.
  expenses: {
    id: string;
    date: string;
    description: string;
    paidBy: string;
    paidByName: string;
    pence: number;
  }[];
  viewer: { userId: string; isAdmin: boolean };
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function computeStatement(input: StatementInput): CostStatement {
  const { rates } = input;
  const own = new Map(input.ownRates.map((r) => [r.userId, r]));

  // Members of the month, plus anyone a flight was charged to or an expense was
  // paid by who is not one.
  const people = new Map<string, { name: string; isMember: boolean }>();
  for (const m of input.members) people.set(m.userId, { name: m.name, isMember: true });
  for (const f of input.flights) {
    if (!people.has(f.chargedTo)) people.set(f.chargedTo, { name: f.chargedName, isMember: false });
  }
  for (const e of input.expenses) {
    if (!people.has(e.paidBy)) people.set(e.paidBy, { name: e.paidByName, isMember: false });
  }

  const rateOf = (userId: string) => {
    const o = own.get(userId);
    return {
      fee: o?.feePence ?? rates.feePence,
      hourly: o?.hourlyPence ?? rates.hourlyPence,
      custom: o !== undefined && (o.feePence !== null || o.hourlyPence !== null),
    };
  };

  // A flight's hourly charge is whole pence per flight at the charged person's
  // rate, rounded half up.
  const flights = input.flights.map((f) => ({
    ...f,
    pence: Math.floor((f.tenths * rateOf(f.chargedTo).hourly + 5) / 10),
  }));
  const totalTenths = flights.reduce((sum, f) => sum + f.tenths, 0);

  const everyone: StatementMember[] = [...people.entries()]
    .map(([userId, p]) => {
      const mine = flights.filter((f) => f.chargedTo === userId);
      const r = rateOf(userId);
      const fixed = p.isMember ? r.fee : 0;
      const hourly = mine.reduce((sum, f) => sum + f.pence, 0);
      const credit = input.expenses.filter((e) => e.paidBy === userId).reduce((sum, e) => sum + e.pence, 0);
      return {
        user_id: userId,
        name: p.name,
        is_member: p.isMember,
        flights: mine.length,
        hours_tenths: mine.reduce((sum, f) => sum + f.tenths, 0),
        fee_pence: r.fee,
        hourly_rate_pence: r.hourly,
        custom_rates: r.custom,
        fixed_pence: fixed,
        hourly_pence: hourly,
        credit_pence: credit,
        total_pence: fixed + hourly - credit,
      };
    })
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.user_id, b.user_id));

  const visible = (userId: string) => input.viewer.isAdmin || userId === input.viewer.userId;
  return {
    result: "ok",
    month: input.month,
    is_admin: input.viewer.isAdmin,
    rates: { fee_pence: rates.feePence, hourly_pence: rates.hourlyPence, missing: rates.missing },
    hours_tenths: totalTenths,
    credits_pence: input.expenses.reduce((sum, e) => sum + e.pence, 0),
    members: everyone.filter((m) => visible(m.user_id)),
    flights: flights
      .filter((f) => visible(f.chargedTo))
      .sort((a, b) => compareText(a.order, b.order) || compareText(a.id, b.id))
      .map((f) => ({
        id: f.id,
        date: f.date,
        from: f.from,
        to: f.to,
        user_id: f.chargedTo,
        hours_tenths: f.tenths,
        pence: f.pence,
      })),
    expenses: input.expenses
      .filter((e) => visible(e.paidBy))
      .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id))
      .map((e) => ({ id: e.id, date: e.date, description: e.description, user_id: e.paidBy, pence: e.pence })),
    // Closing is not part of the calculation: whoever calls this adds it.
    closed: null,
    can_close: false,
    drift: [],
  };
}
