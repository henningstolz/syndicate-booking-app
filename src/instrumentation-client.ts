import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

// Error reporting in the browser (only if NEXT_PUBLIC_SENTRY_DSN is set).
Sentry.init(sentryOptions("client"));
