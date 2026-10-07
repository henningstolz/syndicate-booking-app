// A demo visitor's own changes: the bookings they add, the chat messages they
// post, the flights they log. They live in a small cookie in the visitor's
// browser (only sent to /demo pages) and are laid over the fixed demo data.
// Nothing is ever written to the real database.
//
// Plain TypeScript with no imports, so it can be tested on its own.

export type DemoOverlay = {
  // Bookings added: id, start and end (minutes since 1970), member id, note.
  b: { i: string; s: number; e: number; m: string; n: string }[];
  // Bookings cancelled: booking id -> minute it was cancelled.
  c: Record<string, number>;
  // Chat messages posted: id, author id, text, minute posted.
  g: { i: string; u: string; t: string; a: number }[];
  // Flights logged: id, from, to, category, captain id (null = guest), captain
  // name, fuel left and right, oil, the four times (minutes since 1970),
  // defects.
  f: {
    i: string;
    fr: string;
    to: string;
    ca: string;
    ci: string | null;
    cn: string;
    fl: number;
    fh: number;
    o: number;
    t: [number, number, number, number];
    d: string;
  }[];
  // Flights voided: flight id -> minute and reason.
  v: Record<string, { a: number; r: string }>;
};

export const DEMO_COOKIE = "bt_demo";

// A cookie holds about 4 KB; stay well inside it. That fits roughly ten
// changes, plenty for a visitor to try things out.
export const OVERLAY_MAX_CHARS = 3300;

export function emptyOverlay(): DemoOverlay {
  return { b: [], c: {}, g: [], f: [], v: {} };
}

export function encodeOverlay(overlay: DemoOverlay): string {
  return Buffer.from(JSON.stringify(overlay), "utf8").toString("base64url");
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Anything unreadable or odd-looking becomes an empty overlay: the cookie is
// under the visitor's control, so nothing in it is trusted.
export function decodeOverlay(raw: string | undefined | null): DemoOverlay {
  if (!raw) return emptyOverlay();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!isObject(parsed)) return emptyOverlay();
    const list = (key: string) => (Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : []);
    const map = (key: string): Record<string, unknown> => (isObject(parsed[key]) ? (parsed[key] as Record<string, unknown>) : {});
    const str = (v: unknown) => typeof v === "string";
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

    return {
      b: list("b").filter(
        (x): x is DemoOverlay["b"][number] =>
          isObject(x) && str(x.i) && num(x.s) && num(x.e) && str(x.m) && str(x.n),
      ),
      c: Object.fromEntries(Object.entries(map("c")).filter(([, v]) => num(v))) as Record<string, number>,
      g: list("g").filter(
        (x): x is DemoOverlay["g"][number] =>
          isObject(x) && str(x.i) && str(x.u) && str(x.t) && num(x.a),
      ),
      f: list("f").filter(
        (x): x is DemoOverlay["f"][number] =>
          isObject(x) &&
          str(x.i) && str(x.fr) && str(x.to) && str(x.ca) && str(x.cn) && str(x.d) &&
          (x.ci === null || str(x.ci)) &&
          num(x.fl) && num(x.fh) && num(x.o) &&
          Array.isArray(x.t) && x.t.length === 4 && x.t.every(num),
      ),
      v: Object.fromEntries(
        Object.entries(map("v")).filter(
          ([, v]) => isObject(v) && num(v.a) && str(v.r),
        ),
      ) as DemoOverlay["v"],
    };
  } catch {
    return emptyOverlay();
  }
}

export function overlayFits(overlay: DemoOverlay): boolean {
  return encodeOverlay(overlay).length <= OVERLAY_MAX_CHARS;
}
