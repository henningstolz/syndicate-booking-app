// A stand-in for the Supabase client, used for the demo group. It answers the
// same questions the app's pages ask (select with filters, ordering and paging)
// from the invented demo data, and accepts the few changes a visitor can try
// (book, cancel, post a chat message, log or void a flight). Those changes are
// handed to `persist` (a cookie in the visitor's browser); nothing is ever sent
// to the real database.
//
// It only has to understand the queries the app actually makes. When a page
// starts asking something new, the demo stops with a clear error instead of
// guessing, and `npm run test:demo` (a crawl of every demo page) catches it.
import {
  DEMO_MEMBERS,
  DEMO_USER,
  TABLE_COLUMNS,
  buildDb,
  type DemoDb,
  type Row,
} from "./data.ts";
import { overlayFits, type DemoOverlay } from "./overlay.ts";
import { computeStatement, shiftMonth } from "../costs.ts";
import { londonDateKey } from "../datetime.ts";

const MIN = 60_000;

export const DEMO_LIMIT_MESSAGE =
  "The demo has reached its limit of saved changes. Choose Reset demo to start again.";
const DEMO_READONLY_MESSAGE =
  "This is a demo, so that change isn't saved. Create your own group to use it.";

type DbError = { message: string; code: string; details: null; hint: null };
type Result = { data: unknown; error: DbError | null; count: null; status: number; statusText: string };

const fail = (code: string, message: string): Result => ({
  data: null,
  error: { message, code, details: null, hint: null },
  count: null,
  status: 400,
  statusText: "Bad Request",
});
const ok = (data: unknown): Result => ({ data, error: null, count: null, status: 200, statusText: "OK" });

export type EngineOptions = {
  now: Date;
  overlay: DemoOverlay;
  persist: (next: DemoOverlay) => void;
};

// Splits "a, b, groups(slug)" at the commas that are not inside brackets.
function splitColumns(columns: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of columns) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

type Mode = "select" | "insert" | "update" | "delete";

class Query implements PromiseLike<Result> {
  private mode: Mode = "select";
  private payload: Row | Row[] | null = null;
  private columns = "*";
  private filters: { column: string; test: (value: unknown) => boolean }[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private cardinality: "many" | "maybe" | "one" = "many";

  private engine: Engine;
  private table: keyof DemoDb;

  constructor(engine: Engine, table: keyof DemoDb) {
    this.engine = engine;
    this.table = table;
  }

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.payload = values;
    return this;
  }
  update(values: Row) {
    this.mode = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }

  private filter(column: string, test: (value: unknown) => boolean) {
    this.filters.push({ column, test });
    return this;
  }
  eq(column: string, value: unknown) {
    return this.filter(column, (v) => v === value);
  }
  neq(column: string, value: unknown) {
    return this.filter(column, (v) => v !== value);
  }
  is(column: string, value: null | boolean) {
    return this.filter(column, (v) => (value === null ? v === null || v === undefined : v === value));
  }
  gt(column: string, value: unknown) {
    return this.filter(column, (v) => v != null && compare(v, value) > 0);
  }
  gte(column: string, value: unknown) {
    return this.filter(column, (v) => v != null && compare(v, value) >= 0);
  }
  lt(column: string, value: unknown) {
    return this.filter(column, (v) => v != null && compare(v, value) < 0);
  }
  lte(column: string, value: unknown) {
    return this.filter(column, (v) => v != null && compare(v, value) <= 0);
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  limit(count: number) {
    this.limitTo = count;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  // Only a TypeScript hint in the real client.
  returns<T>() {
    void (undefined as unknown as T);
    return this;
  }
  maybeSingle<T = unknown>() {
    void (undefined as unknown as T);
    this.cardinality = "maybe";
    return this.execute();
  }
  single<T = unknown>() {
    void (undefined as unknown as T);
    this.cardinality = "one";
    return this.execute();
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<Result> {
    try {
      return this.run();
    } catch (error) {
      return fail("demo", error instanceof Error ? error.message : "Demo query failed.");
    }
  }

  private run(): Result {
    const known = TABLE_COLUMNS[this.table];
    if (!known) return fail("42P01", `relation "${this.table}" does not exist`);
    for (const { column } of this.filters) {
      if (!known.includes(column)) return fail("42703", `column ${this.table}.${column} does not exist`);
    }
    for (const { column } of this.orders) {
      if (!known.includes(column)) return fail("42703", `column ${this.table}.${column} does not exist`);
    }

    if (this.mode === "insert") return this.engine.insert(this.table, this.payload as Row);
    if (this.mode === "update") {
      return this.engine.update(this.table, this.payload as Row, this.matching());
    }
    if (this.mode === "delete") return fail("demo", DEMO_READONLY_MESSAGE);

    let rows = this.matching();
    for (const { column, ascending } of [...this.orders].reverse()) {
      // Stable sort, last key first; nulls last when ascending (as in Postgres).
      rows = [...rows].sort((a, b) => {
        const x = a[column];
        const y = b[column];
        if (x == null && y == null) return 0;
        if (x == null) return ascending ? 1 : -1;
        if (y == null) return ascending ? -1 : 1;
        return ascending ? compare(x, y) : compare(y, x);
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);

    const projected: Row[] = [];
    for (const row of rows) {
      const result = this.engine.project(this.table, row, this.columns);
      if ("error" in result) return result.error;
      projected.push(result.row);
    }

    if (this.cardinality === "many") return ok(projected);
    if (projected.length > 1) {
      return fail("PGRST116", "JSON object requested, multiple (or no) rows returned");
    }
    if (projected.length === 0 && this.cardinality === "one") {
      return fail("PGRST116", "JSON object requested, multiple (or no) rows returned");
    }
    return ok(projected[0] ?? null);
  }

  private matching(): Row[] {
    const rows = this.engine.db[this.table];
    return rows.filter((row) => this.filters.every(({ column, test }) => test(row[column])));
  }
}

class Engine {
  db: DemoDb;
  private overlay: DemoOverlay;
  private options: EngineOptions;

  constructor(options: EngineOptions) {
    this.options = options;
    this.overlay = options.overlay;
    this.db = buildDb(options.now, this.overlay);
  }

  // Keeps the new overlay and rebuilds the data from it, so a change made
  // earlier in the same request is visible to later reads.
  private commit(next: DemoOverlay): boolean {
    if (!overlayFits(next)) return false;
    this.overlay = next;
    this.options.persist(next);
    this.db = buildDb(this.options.now, next);
    return true;
  }

  private newId(prefix: string) {
    return `${prefix}-${this.options.now.getTime().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  }

  project(table: keyof DemoDb, row: Row, columns: string): { row: Row } | { error: Result } {
    const known = TABLE_COLUMNS[table];
    const out: Row = {};
    for (const token of splitColumns(columns)) {
      if (token === "*") {
        Object.assign(out, row);
        continue;
      }
      const embed = /^(\w+)\(([^)]*)\)$/.exec(token);
      if (embed) {
        // Only the one join the app uses: a membership's group.
        if (embed[1] !== "groups" || table !== "group_members") {
          return { error: fail("PGRST200", `The demo does not support the embedded resource "${token}".`) };
        }
        const group = this.db.groups.find((g) => g.id === row.group_id);
        const sub: Row = {};
        for (const column of splitColumns(embed[2])) sub[column] = group?.[column] ?? null;
        out[embed[1]] = group ? sub : null;
        continue;
      }
      if (!known.includes(token)) {
        return { error: fail("42703", `column ${table}.${token} does not exist`) };
      }
      out[token] = row[token];
    }
    return { row: out };
  }

  // --------------------------------------------------------------- inserts
  insert(table: keyof DemoDb, payload: Row): Result {
    if (table === "bookings") return this.addBooking(payload);
    if (table === "squawks") return this.addMessage(payload);
    return fail("demo", DEMO_READONLY_MESSAGE);
  }

  private addBooking(p: Row): Result {
    const startsMs = Date.parse(String(p.starts_at));
    const endsMs = Date.parse(String(p.ends_at));
    if (Number.isNaN(startsMs) || Number.isNaN(endsMs) || endsMs <= startsMs) {
      return fail("23514", 'new row for relation "bookings" violates check constraint');
    }
    const clash = this.db.bookings.some(
      (b) =>
        b.status === "confirmed" &&
        startsMs < Date.parse(b.ends_at as string) &&
        endsMs > Date.parse(b.starts_at as string),
    );
    if (clash) {
      return fail("23P01", 'conflicting key value violates exclusion constraint "bookings_group_id_tstzrange_excl"');
    }
    const member = DEMO_MEMBERS.some((m) => m.id === p.member_id) ? String(p.member_id) : DEMO_USER.id;
    const next: DemoOverlay = {
      ...this.overlay,
      b: [
        ...this.overlay.b,
        {
          i: this.newId("demo-b"),
          s: Math.floor(startsMs / MIN),
          e: Math.floor(endsMs / MIN),
          m: member,
          n: String(p.note ?? "").slice(0, 80),
        },
      ],
    };
    return this.commit(next) ? ok(null) : fail("demo_limit", DEMO_LIMIT_MESSAGE);
  }

  private addMessage(p: Row): Result {
    const text = String(p.message ?? "").trim().slice(0, 280);
    if (!text) return fail("23514", "message is empty");
    const next: DemoOverlay = {
      ...this.overlay,
      g: [
        ...this.overlay.g,
        { i: this.newId("demo-m"), u: DEMO_USER.id, t: text, a: Math.floor(this.options.now.getTime() / MIN) },
      ],
    };
    return this.commit(next) ? ok(null) : fail("demo_limit", DEMO_LIMIT_MESSAGE);
  }

  // --------------------------------------------------------------- updates
  update(table: keyof DemoDb, values: Row, matching: Row[]): Result {
    // The only change the app makes to a booking is cancelling it.
    if (table !== "bookings" || values.status !== "cancelled") {
      return fail("demo", DEMO_READONLY_MESSAGE);
    }
    const cancelled = { ...this.overlay.c };
    const minute = Math.floor(this.options.now.getTime() / MIN);
    for (const row of matching) cancelled[row.id as string] = minute;
    return this.commit({ ...this.overlay, c: cancelled }) ? ok(null) : fail("demo_limit", DEMO_LIMIT_MESSAGE);
  }

  // ------------------------------------------------------------------ rpc
  rpc(name: string, args: Record<string, unknown> = {}) {
    let outcome: Result;
    if (name === "add_flight_entry") outcome = ok(this.addFlight(args));
    else if (name === "void_flight_entry") outcome = ok(this.voidFlight(args));
    else if (name === "cost_statement") outcome = ok(this.costStatement(args));
    else outcome = ok({ result: "demo" });
    const promise = Promise.resolve(outcome);
    // Enough of the real call's shape for the way the app uses it.
    return Object.assign(promise, {
      returns() {
        return this;
      },
      maybeSingle() {
        return promise;
      },
    });
  }

  // The month's statement for the visitor (Alex, the admin), worked out by the
  // same calculation the database uses (src/lib/costs.ts; migrations 0016 and 0018).
  private costStatement(a: Record<string, unknown>) {
    const match = /^(\d{4})-(\d{2})/.exec(String(a.p_month ?? ""));
    if (!match || Number(match[1]) < 2000 || Number(match[1]) > 2100 || Number(match[2]) < 1 || Number(match[2]) > 12) {
      return { result: "month_invalid" };
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const start = `${match[1]}-${match[2]}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${match[1]}-${String(month + 1).padStart(2, "0")}-01`;

    // The latest row starting on or before the month, optionally for one member.
    const latest = (userId: string | null) =>
      this.db.cost_rates
        .filter((r) => (r.user_id ?? null) === userId && (r.effective_month as string) <= start)
        .sort((x, y) => String(y.effective_month).localeCompare(String(x.effective_month)) || String(y.created_at).localeCompare(String(x.created_at)))[0];
    const rate = latest(null);

    const nameOf = (userId: string) =>
      (this.db.group_members.find((m) => m.user_id === userId)?.display_name as string | null) ?? "Member";
    const members = this.db.group_members
      .filter(
        (m) =>
          londonDateKey(new Date(m.created_at as string)) < next &&
          (!m.removed_at || londonDateKey(new Date(m.removed_at as string)) >= start),
      )
      .map((m) => ({ userId: m.user_id as string, name: nameOf(m.user_id as string) }));

    const flights = this.db.flight_entries
      .filter((f) => !f.voided_at && (f.flight_date as string) >= start && (f.flight_date as string) < next)
      .map((f) => {
        const chargedTo = ((f.captain_id as string | null) ?? (f.created_by as string));
        return {
          id: f.id as string,
          date: f.flight_date as string,
          from: f.from_place as string,
          to: f.to_place as string,
          chargedTo,
          chargedName: nameOf(chargedTo),
          tenths: Math.round((f.block_deci as number) * 10),
          order: f.brakes_off as string,
        };
      });

    const expenses = this.db.cost_expenses
      .filter((c) => !c.voided_at && (c.incurred_on as string) >= start && (c.incurred_on as string) < next)
      .map((c) => ({
        id: c.id as string,
        date: c.incurred_on as string,
        description: c.description as string,
        paidBy: c.paid_by as string,
        paidByName: nameOf(c.paid_by as string),
        pence: c.amount_pence as number,
      }));

    const ownRates = DEMO_MEMBERS.flatMap((m) => {
      const own = latest(m.id);
      return own
        ? [{ userId: m.id as string, feePence: own.monthly_fee_pence as number | null, hourlyPence: own.hourly_rate_pence as number | null }]
        : [];
    });

    const statement = computeStatement({
      month: start,
      rates: rate
        ? { feePence: rate.monthly_fee_pence as number, hourlyPence: rate.hourly_rate_pence as number, missing: false }
        : { feePence: 0, hourlyPence: 0, missing: true },
      ownRates,
      members,
      flights,
      expenses,
      viewer: { userId: DEMO_USER.id, isAdmin: true },
    });

    // Closing: last month is finished but still open (so the visitor sees the
    // button, which says it is a demo); anything older with rates is shown as
    // closed on the 1st of the following month by Alex. Nothing is ever saved.
    const thisMonth = londonDateKey(this.options.now).slice(0, 7);
    const lastMonth = shiftMonth(thisMonth, -1);
    const key = start.slice(0, 7);
    if (key < lastMonth && !statement.rates.missing) {
      return {
        ...statement,
        closed: {
          id: `demo-closure-${key}`,
          closed_at: new Date(`${shiftMonth(key, 1)}-02T10:00:00Z`).toISOString(),
          closed_by_name: nameOf(DEMO_USER.id),
          note: null,
        },
      };
    }
    return { ...statement, can_close: key <= lastMonth && !statement.rates.missing };
  }

  // The same rules as the add_flight_entry database function (migration 0011).
  private addFlight(a: Record<string, unknown>) {
    const from = String(a.p_from ?? "").trim().toUpperCase();
    const to = String(a.p_to ?? "").trim().toUpperCase();
    if (from === "" || to === "") return { result: "place_required" };
    if (from.length > 40 || to.length > 40) return { result: "place_too_long" };
    const category = String(a.p_category ?? "");
    if (!["PV", "TG", "PT"].includes(category)) return { result: "category_invalid" };

    let captainId: string | null = null;
    let captainName: string;
    if (a.p_captain_id) {
      const member = DEMO_MEMBERS.find((m) => m.id === a.p_captain_id);
      if (!member) return { result: "captain_invalid" };
      captainId = member.id;
      captainName = member.name;
    } else {
      captainName = String(a.p_captain_name ?? "").trim();
      if (captainName === "") return { result: "captain_required" };
      if (captainName.length > 60) return { result: "captain_invalid" };
    }

    const number = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const left = number(a.p_fuel_left);
    const right = number(a.p_fuel_right);
    if (left === null || right === null || Number.isNaN(left) || Number.isNaN(right) ||
        left < 0 || left > 100 || right < 0 || right > 100) return { result: "fuel_invalid" };
    const oil = number(a.p_oil);
    if (oil === null || Number.isNaN(oil) || oil < 0 || oil > 20) return { result: "oil_invalid" };

    const times = [a.p_brakes_off, a.p_airborne, a.p_landed, a.p_brakes_on].map((v) =>
      typeof v === "string" ? Math.floor(Date.parse(v) / MIN) : NaN,
    );
    if (times.some(Number.isNaN)) return { result: "times_order" };
    const [off, up, down, on] = times;
    if (!(off <= up && up <= down && down <= on && on > off)) return { result: "times_order" };
    if (on - off > 16 * 60) return { result: "too_long" };
    if (off * MIN > this.options.now.getTime() + 2 * 60 * MIN) return { result: "in_future" };

    const overlaps = this.db.flight_entries.some(
      (f) =>
        !f.voided_at &&
        off * MIN < Date.parse(f.brakes_on as string) &&
        on * MIN > Date.parse(f.brakes_off as string),
    );
    if (overlaps) return { result: "overlap" };

    // The demo keeps defect notes short so a few of them fit in the cookie.
    const defects = String(a.p_defects ?? "").trim().slice(0, 200);
    const next: DemoOverlay = {
      ...this.overlay,
      f: [
        ...this.overlay.f,
        {
          i: this.newId("demo-f"),
          fr: from.slice(0, 12),
          to: to.slice(0, 12),
          ca: category,
          ci: captainId,
          cn: captainName,
          fl: Math.round(left * 10) / 10,
          fh: Math.round(right * 10) / 10,
          o: Math.round(oil * 10) / 10,
          t: [off, up, down, on],
          d: defects,
        },
      ],
    };
    return this.commit(next) ? { result: "ok" } : { result: "demo_limit" };
  }

  private voidFlight(a: Record<string, unknown>) {
    const flight = this.db.flight_entries.find((f) => f.id === a.p_entry_id);
    if (!flight) return { result: "not_found" };
    const reason = String(a.p_reason ?? "").trim();
    if (reason.length < 3) return { result: "reason_required" };
    if (reason.length > 300) return { result: "reason_too_long" };
    if (flight.voided_at) return { result: "already_voided" };
    const next: DemoOverlay = {
      ...this.overlay,
      v: {
        ...this.overlay.v,
        [flight.id as string]: { a: Math.floor(this.options.now.getTime() / MIN), r: reason.slice(0, 120) },
      },
    };
    return this.commit(next) ? { result: "ok" } : { result: "demo_limit" };
  }
}

// What the app expects from the client, in the parts it uses.
export function createDemoEngine(options: EngineOptions) {
  const engine = new Engine(options);
  return {
    from: (table: string) => new Query(engine, table as keyof DemoDb),
    rpc: (name: string, args?: Record<string, unknown>) => engine.rpc(name, args),
    auth: {
      getUser: async () => ({ data: { user: { ...DEMO_USER } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}
