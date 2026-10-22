import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

// The settings shared by the server and the browser. Errors only (no tracing, no session
// replay, which also keeps the free plan's limits safe), no personal data by default, and
// everything that is sent goes through the scrubber first. With no DSN set (a local
// machine, or before the account exists) Sentry stays off.
export function sentryOptions(where: "server" | "client") {
  const dsn = where === "client" ? process.env.NEXT_PUBLIC_SENTRY_DSN : process.env.SENTRY_DSN;
  const environment =
    where === "client"
      ? typeof window !== "undefined" && window.location.hostname === "blocktime.group"
        ? "production"
        : "other"
      : (process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown");
  return {
    dsn,
    enabled: Boolean(dsn),
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // The scrubber works on plain objects; Sentry's own event types are wider than it needs.
    beforeSend: <T extends object>(event: T): T => scrubEvent(event as Record<string, unknown>) as T,
    beforeBreadcrumb: <T extends object>(crumb: T): T | null => scrubBreadcrumb(crumb as Record<string, unknown>) as T | null,
  };
}
