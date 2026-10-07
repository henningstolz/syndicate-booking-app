// Money helpers and the monthly cost statement.
//
// computeStatement() is an exact twin of the database function cost_statement()
// (migration 0015). The database is the real thing; this copy lets the demo
// show believable statements, and a test compares the two on hundreds of random
// months so they cannot drift apart. No imports, so tests can load it in plain
// Node.
//
// The rule: each member pays a FIXED monthly share, plus the HOURLY rate for the
// block hours charged to them, plus a share of the month's FUEL (and other
// shared costs) in proportion to those hours. All money is whole pence.

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
  fixed_pence: number;
  hourly_pence: number;
  fuel_pence: number;
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

export type CostStatement = {
  result: "ok";
  month: string;
  is_admin: boolean;
  rates: { fee_pence: number; hourly_pence: number; missing: boolean };
  fuel_pence: number;
  hours_tenths: number;
  members: StatementMember[];
  flights: StatementFlight[];
};

export type StatementInput = {
  month: string; // "2026-10-01"
  rates: { feePence: number; hourlyPence: number; missing: boolean };
  fuelPence: number;
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
  viewer: { userId: string; isAdmin: boolean };
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function computeStatement(input: StatementInput): CostStatement {
  const { rates, fuelPence } = input;

  // A flight's hourly charge is whole pence per flight, rounded half up.
  const flights = input.flights.map((f) => ({
    ...f,
    pence: Math.floor((f.tenths * rates.hourlyPence + 5) / 10),
  }));
  const totalTenths = flights.reduce((sum, f) => sum + f.tenths, 0);

  // Members of the month, plus anyone a flight was charged to who is not one.
  const people = new Map<string, { name: string; isMember: boolean }>();
  for (const m of input.members) people.set(m.userId, { name: m.name, isMember: true });
  for (const f of flights) {
    if (!people.has(f.chargedTo)) people.set(f.chargedTo, { name: f.chargedName, isMember: false });
  }

  const rows = [...people.entries()].map(([userId, p]) => {
    const mine = flights.filter((f) => f.chargedTo === userId);
    return {
      userId,
      name: p.name,
      isMember: p.isMember,
      flights: mine.length,
      tenths: mine.reduce((sum, f) => sum + f.tenths, 0),
      hourly: mine.reduce((sum, f) => sum + f.pence, 0),
    };
  });

  // Fuel by hours flown, or equally if nobody flew; the largest-remainder
  // method hands out the leftover pence so the shares add up exactly.
  const denominator = totalTenths > 0 ? totalTenths : rows.length;
  const shares = rows.map((r) => {
    const numerator = totalTenths > 0 ? fuelPence * r.tenths : fuelPence;
    return { userId: r.userId, base: Math.floor(numerator / denominator), rest: numerator % denominator };
  });
  const leftover = fuelPence - shares.reduce((sum, s) => sum + s.base, 0);
  const byRest = [...shares].sort((a, b) => b.rest - a.rest || compareText(a.userId, b.userId));
  const bonus = new Set(byRest.slice(0, leftover).map((s) => s.userId));
  const fuelOf = new Map(shares.map((s) => [s.userId, s.base + (bonus.has(s.userId) ? 1 : 0)]));

  const everyone: StatementMember[] = rows
    .map((r) => {
      const fixed = r.isMember ? rates.feePence : 0;
      const fuel = fuelOf.get(r.userId) ?? 0;
      return {
        user_id: r.userId,
        name: r.name,
        is_member: r.isMember,
        flights: r.flights,
        hours_tenths: r.tenths,
        fixed_pence: fixed,
        hourly_pence: r.hourly,
        fuel_pence: fuel,
        total_pence: fixed + r.hourly + fuel,
      };
    })
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.user_id, b.user_id));

  const visible = (userId: string) => input.viewer.isAdmin || userId === input.viewer.userId;
  return {
    result: "ok",
    month: input.month,
    is_admin: input.viewer.isAdmin,
    rates: { fee_pence: rates.feePence, hourly_pence: rates.hourlyPence, missing: rates.missing },
    fuel_pence: fuelPence,
    hours_tenths: totalTenths,
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
  };
}
