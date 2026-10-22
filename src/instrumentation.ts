import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

// Runs once when the server starts: switches error reporting on (only if SENTRY_DSN is
// set; see src/lib/sentry-options.ts for what is and is not sent).
export function register() {
  Sentry.init(sentryOptions("server"));
}

// Reports errors from pages, server actions and route handlers.
export const onRequestError = Sentry.captureRequestError;
