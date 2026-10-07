import { cookies } from "next/headers";
import { createDemoEngine } from "./engine.ts";
import { DEMO_COOKIE, decodeOverlay, encodeOverlay } from "./overlay.ts";

// The demo's stand-in for the database client. The visitor's own changes are
// kept in a cookie that is only sent to /demo pages and lasts a day.
export async function createDemoClient() {
  const store = await cookies();
  return createDemoEngine({
    now: new Date(),
    overlay: decodeOverlay(store.get(DEMO_COOKIE)?.value),
    persist(next) {
      try {
        store.set(DEMO_COOKIE, encodeOverlay(next), {
          path: "/demo",
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 24,
        });
      } catch {
        // Called while rendering a page rather than from a server action:
        // cookies cannot be set there. Pages only read, so this is safe.
      }
    },
  });
}
