// The demo group: an invented flying group with made-up members, bookings,
// chat messages, aircraft dates and logged flights. Everything is generated
// relative to "today" (so the demo always looks current) from a fixed random
// seed (so it looks the same every time). It never touches the database.
//
// Relative imports with .ts extensions so the demo's tests can run in plain
// Node (see src/lib/unit.test.mjs).
import { addLondonCalendarDays, londonDateKey, londonWallTimeToUtc } from "../datetime.ts";
import { minutesToDeci } from "../flight-times.ts";
import type { DemoOverlay } from "./overlay.ts";

export const DEMO_SLUG = "demo";
export const DEMO_GROUP_ID = "demo-group";

// The visitor acts as Alex, the demo group's admin.
export const DEMO_USER = { id: "demo-alex", email: "alex@demo.example" };

export const DEMO_MEMBERS = [
  { id: "demo-alex", name: "Alex", role: "admin" },
  { id: "demo-sam", name: "Sam", role: "member" },
  { id: "demo-jordan", name: "Jordan", role: "member" },
  { id: "demo-taylor", name: "Taylor", role: "member" },
] as const;

export type Row = Record<string, unknown>;

export type DemoDb = {
  groups: Row[];
  group_members: Row[];
  bookings: Row[];
  squawks: Row[];
  flight_entries: Row[];
  invites: Row[];
  notification_preferences: Row[];
  cost_rates: Row[];
  cost_expenses: Row[];
};

// Columns of each table, so a query that asks for one that does not exist
// fails in the demo exactly as it would against the real database.
export const TABLE_COLUMNS: Record<keyof DemoDb, string[]> = {
  groups: [
    "id", "slug", "name", "aircraft_registration", "aircraft_type", "home_base",
    "created_at", "annual_renewal_due", "insurance_renewal_due", "next_check_due",
    "hours_to_next_check", "life_raft_due", "life_vests_due", "fire_extinguisher_due",
    "airframe_hours_baseline", "airframe_total_hours", "next_check_at_hours",
  ],
  group_members: ["id", "group_id", "user_id", "role", "display_name", "created_at", "removed_at"],
  bookings: [
    "id", "group_id", "member_id", "starts_at", "ends_at", "note", "status",
    "cancelled_at", "cancelled_by", "created_at",
  ],
  squawks: ["id", "group_id", "author_id", "message", "created_at"],
  flight_entries: [
    "id", "group_id", "flight_date", "from_place", "to_place", "flight_category",
    "captain_id", "captain_name", "fuel_left_usg", "fuel_right_usg", "oil_qt",
    "brakes_off", "airborne", "landed", "brakes_on", "block_minutes", "flight_minutes",
    "block_deci", "flight_deci", "check_limit_hours", "defects", "created_by",
    "created_at", "voided_at", "voided_by", "void_reason",
  ],
  invites: ["id", "group_id", "role", "label", "created_by", "created_at", "expires_at", "revoked_at", "used_by", "used_at"],
  notification_preferences: ["group_id", "user_id", "event", "enabled", "updated_at"],
  cost_rates: ["id", "group_id", "user_id", "effective_month", "monthly_fee_pence", "hourly_rate_pence", "created_by", "created_at"],
  cost_expenses: [
    "id", "group_id", "paid_by", "incurred_on", "description", "amount_pence",
    "created_by", "created_at", "voided_at", "voided_by", "void_reason",
  ],
};

const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (value: number) => Math.round(value * 10) / 10;

// Small seeded random number generator (mulberry32).
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTES = [
  "Local flight", "Circuits", "Fly-out lunch", "Currency flight",
  "Short trip", "Weekend away", "Photo flight", "Navigation practice",
];

type Booking = {
  id: string;
  member: string;
  startKey: string;
  endKey: string;
  from: string;
  to: string;
  note: string;
  status: "confirmed" | "cancelled";
};

const SLOT = {
  am: { from: "08:00", to: "12:30" },
  pm: { from: "13:00", to: "17:30" },
  full: { from: "08:00", to: "18:00" },
} as const;

// A flight's calculated columns, the way the database generates them.
export function flightColumns(offMs: number, upMs: number, downMs: number, onMs: number) {
  const block = Math.round((onMs - offMs) / MIN);
  const flight = Math.round((downMs - upMs) / MIN);
  return {
    flight_date: londonDateKey(new Date(offMs)),
    block_minutes: block,
    flight_minutes: flight,
    block_deci: minutesToDeci(block),
    flight_deci: minutesToDeci(flight),
  };
}

export function buildDb(now: Date, overlay: DemoOverlay): DemoDb {
  const nowMs = now.getTime();
  const today = londonDateKey(now);
  const noon = londonWallTimeToUtc(today, "12:00");
  const dayKey = (offset: number) => londonDateKey(addLondonCalendarDays(noon, offset));
  const at = (key: string, time: string) => londonWallTimeToUtc(key, time).getTime();

  // ------------------------------------------------------------- bookings
  const rand = seeded(20261007);
  const bookings: Booking[] = [];
  const busy = new Set<number>(); // day offsets that already have a booking
  let counter = 0;

  const addBooking = (
    member: string,
    startOffset: number,
    days: number,
    slot: keyof typeof SLOT,
    note: string,
    status: Booking["status"] = "confirmed",
  ) => {
    for (let d = 0; d < days; d++) busy.add(startOffset + d);
    bookings.push({
      id: `demo-b-${++counter}`,
      member,
      startKey: dayKey(startOffset),
      endKey: dayKey(startOffset + days - 1),
      from: days > 1 ? "08:00" : SLOT[slot].from,
      to: days > 1 ? "18:00" : SLOT[slot].to,
      note,
      status,
    });
  };

  // Hand-placed upcoming bookings, so the demo always has a "next up", a
  // busy week and a multi-day trip to show. The trip is a real weekend
  // (Saturday to Monday); the others slide to the next free day.
  const weekdayOf = (offset: number) => new Date(`${dayKey(offset)}T12:00:00Z`).getUTCDay();
  const free = (offset: number, days: number) =>
    Array.from({ length: days }, (_, d) => !busy.has(offset + d)).every(Boolean);
  const place = (member: string, wanted: number, days: number, slot: keyof typeof SLOT, note: string) => {
    let offset = wanted;
    while (!free(offset, days)) offset++;
    addBooking(member, offset, days, slot, note);
  };
  let saturday = (6 - weekdayOf(0) + 7) % 7;
  if (saturday < 4) saturday += 7;
  place("demo-taylor", saturday, 3, "full", "Weekend trip");
  place("demo-sam", 1, 1, "am", "Local flight");
  place("demo-alex", 3, 1, "pm", "Currency flight");
  place("demo-jordan", 12, 1, "full", "Fly-out lunch");
  place("demo-alex", 14, 1, "am", "Circuits");

  const pickMember = () => {
    const r = rand();
    return r < 0.36 ? "demo-alex" : r < 0.64 ? "demo-sam" : r < 0.84 ? "demo-jordan" : "demo-taylor";
  };
  const randomRange = (from: number, to: number) => {
    for (let offset = from; offset <= to; offset++) {
      if (busy.has(offset)) continue;
      const weekday = weekdayOf(offset);
      const chance = weekday === 0 || weekday === 6 ? 0.68 : weekday === 5 ? 0.34 : 0.26;
      if (rand() >= chance) continue;
      const member = pickMember();
      const note = rand() < 0.5 ? NOTES[Math.floor(rand() * NOTES.length)] : "";
      const kind = rand();
      const days = kind > 0.88 && !busy.has(offset + 1) && !busy.has(offset + 2) && offset + 2 <= to ? 2 + (rand() < 0.4 ? 1 : 0) : 1;
      const slot: keyof typeof SLOT = kind < 0.28 ? "am" : kind < 0.55 ? "pm" : "full";
      const status = rand() < 0.05 ? "cancelled" : "confirmed";
      addBooking(member, offset, days, slot, note, status);
    }
  };
  randomRange(-430, -1);
  randomRange(16, 24);

  const fixtureBookingRows: Row[] = bookings.map((b) => ({
    id: b.id,
    group_id: DEMO_GROUP_ID,
    member_id: b.member,
    starts_at: iso(at(b.startKey, b.from)),
    ends_at: iso(at(b.endKey, b.to)),
    note: b.note || null,
    status: b.status,
    cancelled_at: b.status === "cancelled" ? iso(at(b.startKey, "08:00") - 2 * DAY) : null,
    cancelled_by: b.status === "cancelled" ? b.member : null,
    created_at: iso(at(b.startKey, "08:00") - 9 * DAY),
  }));

  // The visitor's own bookings, and any cancellations they made, laid over
  // copies of the fixed ones. (The demo flights below come from the FIXED
  // bookings only, so what a visitor does never changes which flights exist.)
  const bookingRows: Row[] = fixtureBookingRows.map((row) => ({ ...row }));
  for (const added of overlay.b) {
    bookingRows.push({
      id: added.i,
      group_id: DEMO_GROUP_ID,
      member_id: added.m,
      starts_at: iso(added.s * MIN),
      ends_at: iso(added.e * MIN),
      note: added.n || null,
      status: "confirmed",
      cancelled_at: null,
      cancelled_by: null,
      created_at: iso(added.s * MIN - DAY),
    });
  }
  for (const row of bookingRows) {
    const cancelledAt = overlay.c[row.id as string];
    if (cancelledAt !== undefined) {
      row.status = "cancelled";
      row.cancelled_at = iso(cancelledAt * MIN);
      row.cancelled_by = DEMO_USER.id;
    }
  }

  // -------------------------------------------------------------- flights
  // A flight for each booking in the last five weeks (two for a trip).
  const flightRand = seeded(777);
  const ROUTES: [string, string][] = [
    ["EGXX", "EGXX"], ["EGXX", "EGXX"], ["EGXX", "EGXX"],
    ["EGXX", "EGTK"], ["EGTK", "EGXX"], ["EGXX", "EGKA"], ["EGKA", "EGXX"], ["EGXX", "EGHP"],
  ];
  type RawFlight = { member: string; offMs: number; upMs: number; downMs: number; onMs: number; route: [string, string] };
  const raw: RawFlight[] = [];
  const recent = fixtureBookingRows
    .filter(
      (b) =>
        b.status === "confirmed" &&
        Date.parse(b.ends_at as string) < nowMs &&
        Date.parse(b.starts_at as string) > nowMs - 38 * DAY,
    )
    .sort((a, b) => (a.starts_at as string).localeCompare(b.starts_at as string));
  for (const booking of recent) {
    const startMs = Date.parse(booking.starts_at as string);
    const endMs = Date.parse(booking.ends_at as string);
    const starts = [startMs];
    if (endMs - startMs > 2 * DAY) starts.push(endMs - 10 * 60 * MIN); // last day of a trip
    for (const dayStart of starts) {
      const off = dayStart + (10 + Math.floor(flightRand() * 21)) * MIN;
      const up = off + (6 + Math.floor(flightRand() * 6)) * MIN;
      const down = up + (45 + Math.floor(flightRand() * 95)) * MIN;
      const on = down + (5 + Math.floor(flightRand() * 7)) * MIN;
      raw.push({
        member: booking.member_id as string,
        offMs: off, upMs: up, downMs: down, onMs: on,
        route: ROUTES[Math.floor(flightRand() * ROUTES.length)],
      });
    }
  }

  const DEFECTS: Record<number, string> = {
    3: "Left brake pedal feels slightly spongy. To be checked at the next maintenance.",
    8: "Landing light flickers on and off.",
  };
  const memberName = (id: string) => DEMO_MEMBERS.find((m) => m.id === id)?.name ?? "Member";
  const fuel = () => Math.round((14 + flightRand() * 10) * 2) / 2;
  const oil = () => Math.round((6.5 + flightRand() * 1.5) * 2) / 2;

  const flights: Row[] = raw.map((f, index) => {
    const guest = index === 2;
    return {
      id: `demo-f-${index + 1}`,
      group_id: DEMO_GROUP_ID,
      ...flightColumns(f.offMs, f.upMs, f.downMs, f.onMs),
      from_place: f.route[0],
      to_place: f.route[1],
      flight_category: guest ? "TG" : "PV",
      captain_id: guest ? null : f.member,
      captain_name: guest ? "Chris Parker (instructor)" : memberName(f.member),
      fuel_left_usg: fuel(),
      fuel_right_usg: fuel(),
      oil_qt: oil(),
      brakes_off: iso(f.offMs),
      airborne: iso(f.upMs),
      landed: iso(f.downMs),
      brakes_on: iso(f.onMs),
      check_limit_hours: null,
      defects: DEFECTS[index] ?? null,
      created_by: guest ? DEMO_USER.id : f.member,
      created_at: iso(f.onMs + 20 * MIN),
      voided_at: null,
      voided_by: null,
      void_reason: null,
    };
  });

  // One entry entered on the wrong day and voided, as a demonstration.
  if (raw.length > 6) {
    const f = raw[5];
    const shift = DAY;
    flights.push({
      id: "demo-f-void",
      group_id: DEMO_GROUP_ID,
      ...flightColumns(f.offMs - shift, f.upMs - shift, f.downMs - shift, f.onMs - shift),
      from_place: f.route[0],
      to_place: f.route[1],
      flight_category: "PV",
      captain_id: f.member,
      captain_name: memberName(f.member),
      fuel_left_usg: 20,
      fuel_right_usg: 20,
      oil_qt: 7,
      brakes_off: iso(f.offMs - shift),
      airborne: iso(f.upMs - shift),
      landed: iso(f.downMs - shift),
      brakes_on: iso(f.onMs - shift),
      check_limit_hours: null,
      defects: null,
      created_by: f.member,
      created_at: iso(f.onMs + 30 * MIN),
      voided_at: iso(f.onMs + 3 * 60 * MIN),
      voided_by: DEMO_USER.id,
      void_reason: "Wrong date, re-entered",
    });
  }

  // ----------------------------------------------- aircraft hours and checks
  const baseline = 2403.6;
  const fixtureFlown = round1(
    flights.reduce((sum, f) => sum + (f.voided_at ? 0 : (f.flight_deci as number)), 0),
  );
  // The check limit sits a little above where the airframe is now, so the
  // demo shows the "due soon" warning.
  const nextCheckAt = round1(baseline + fixtureFlown + 8.6);
  for (const f of flights) f.check_limit_hours = nextCheckAt;

  // The visitor's own flights (and voids) laid over the fixed ones.
  for (const added of overlay.f) {
    const [off, up, down, on] = added.t.map((m) => m * MIN) as [number, number, number, number];
    flights.push({
      id: added.i,
      group_id: DEMO_GROUP_ID,
      ...flightColumns(off, up, down, on),
      from_place: added.fr,
      to_place: added.to,
      flight_category: added.ca,
      captain_id: added.ci,
      captain_name: added.cn,
      fuel_left_usg: added.fl,
      fuel_right_usg: added.fh,
      oil_qt: added.o,
      brakes_off: iso(off),
      airborne: iso(up),
      landed: iso(down),
      brakes_on: iso(on),
      check_limit_hours: nextCheckAt,
      defects: added.d || null,
      created_by: DEMO_USER.id,
      created_at: iso(on),
      voided_at: null,
      voided_by: null,
      void_reason: null,
    });
  }
  for (const f of flights) {
    const voided = overlay.v[f.id as string];
    if (voided) {
      f.voided_at = iso(voided.a * MIN);
      f.voided_by = DEMO_USER.id;
      f.void_reason = voided.r;
    }
  }

  const flown = round1(
    flights.reduce((sum, f) => sum + (f.voided_at ? 0 : (f.flight_deci as number)), 0),
  );
  const total = round1(baseline + flown);

  // --------------------------------------------------------------- group
  const dateIn = (days: number) => dayKey(days);
  const group: Row = {
    id: DEMO_GROUP_ID,
    slug: DEMO_SLUG,
    name: "Demo Flying Group",
    aircraft_registration: "G-DEMO",
    aircraft_type: "Piper PA28R Arrow",
    home_base: "EGXX",
    created_at: iso(nowMs - 440 * DAY),
    annual_renewal_due: dateIn(270),
    insurance_renewal_due: dateIn(66),
    next_check_due: dateIn(24),
    hours_to_next_check: round1(nextCheckAt - total),
    life_raft_due: dateIn(150),
    life_vests_due: dateIn(150),
    fire_extinguisher_due: dateIn(330),
    airframe_hours_baseline: baseline,
    airframe_total_hours: total,
    next_check_at_hours: nextCheckAt,
  };

  // --------------------------------------------------------------- chat
  const hoursAgo = (h: number) => iso(nowMs - h * 60 * MIN);
  const messages: Row[] = [
    ["demo-alex", "Welcome to the demo! Try booking a slot in the Calendar, logging a flight in the Tech log, or posting a message here. Nothing is saved.", 1],
    ["demo-taylor", "I've booked the aircraft for a weekend trip, Saturday to Monday. Room for a passenger if anyone fancies it.", 20],
    ["demo-sam", "Fuel bowser is out of order until Friday. The self-serve pump by the clubhouse works fine.", 52],
    ["demo-jordan", "I left my headset bag in the aircraft by mistake. I'll pick it up on Sunday.", 120],
    ["demo-alex", "Reminder: the next check is coming up. I'll book the slot with the engineers once we know the date.", 200],
  ].map(([author, text, hours], index) => ({
    id: `demo-m-${index + 1}`,
    group_id: DEMO_GROUP_ID,
    author_id: author as string,
    message: text as string,
    created_at: hoursAgo(hours as number),
  }));
  // A message about the landing-light defect, from whoever logged it, shortly
  // after that flight.
  const lightFlight = flights.find((f) => f.defects === DEFECTS[8]);
  if (lightFlight) {
    messages.push({
      id: "demo-m-light",
      group_id: DEMO_GROUP_ID,
      author_id: (lightFlight.captain_id as string | null) ?? DEMO_USER.id,
      message: "The landing light was flickering on my flight. I've put it in the tech log.",
      created_at: iso(Date.parse(lightFlight.brakes_on as string) + 60 * MIN),
    });
  }
  for (const added of overlay.g) {
    messages.push({
      id: added.i,
      group_id: DEMO_GROUP_ID,
      author_id: added.u,
      message: added.t,
      created_at: iso(added.a * MIN),
    });
  }

  // ------------------------------------------------------------- members
  const members: Row[] = DEMO_MEMBERS.map((m, index) => ({
    id: `demo-gm-${index + 1}`,
    group_id: DEMO_GROUP_ID,
    user_id: m.id,
    role: m.role,
    display_name: m.name,
    created_at: iso(nowMs - (430 - index) * DAY),
    removed_at: null,
  }));

  // ------------------------------------------------------------------- costs
  // The first day of the month `monthsAgo` months back (a UK date).
  const [thisYear, thisMonth] = today.split("-").map(Number);
  const monthStart = (monthsAgo: number) => {
    const index = thisYear * 12 + (thisMonth - 1) - monthsAgo;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
  };
  // The group's rates, and one member (Taylor) with rates of their own: no
  // fixed share, a higher hourly rate.
  const costRates: Row[] = [
    [null, 14, 11000, 6000],
    [null, 4, 12000, 6500],
    ["demo-taylor", 4, 0, 9000],
  ].map(([userId, monthsAgo, fee, hourly], index) => ({
    id: `demo-r-${index + 1}`,
    group_id: DEMO_GROUP_ID,
    user_id: userId,
    effective_month: monthStart(monthsAgo as number),
    monthly_fee_pence: fee,
    hourly_rate_pence: hourly,
    created_by: DEMO_USER.id,
    created_at: iso(at(monthStart(monthsAgo as number), "09:00")),
  }));
  // Fuel a member bought away from home, credited to them.
  const costExpenses: Row[] = [
    [-3, "demo-sam", "Fuel at Sywell", 18400],
    [-21, "demo-jordan", "Fuel at Shobdon", 15250],
    [-36, "demo-sam", "Fuel at Sywell", 20100],
    [-52, "demo-taylor", "Landing fee, Old Warden", 2500],
  ].map(([offset, paidBy, description, amount], index) => ({
    id: `demo-x-${index + 1}`,
    group_id: DEMO_GROUP_ID,
    paid_by: paidBy,
    incurred_on: dayKey(offset as number),
    description,
    amount_pence: amount,
    created_by: DEMO_USER.id,
    created_at: iso(at(dayKey(offset as number), "18:00")),
    voided_at: null,
    voided_by: null,
    void_reason: null,
  }));

  return {
    groups: [group],
    group_members: members,
    bookings: bookingRows,
    squawks: messages,
    flight_entries: flights,
    invites: [],
    // No explicit choices: the demo shows the defaults.
    notification_preferences: [],
    cost_rates: costRates,
    cost_expenses: costExpenses,
  };
}
