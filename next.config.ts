import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The group chat used to be /squawks, then the Notes tab of the tech log,
      // then /board. Keep old links and bookmarks working.
      {
        source: "/:groupSlug/squawks",
        destination: "/:groupSlug/chat",
        permanent: false,
      },
      {
        source: "/:groupSlug/board",
        destination: "/:groupSlug/chat",
        permanent: false,
      },
      {
        source: "/:groupSlug/tech-log",
        has: [{ type: "query", key: "view", value: "notes" }],
        destination: "/:groupSlug/chat",
        permanent: false,
      },
    ];
  },
};

// Error monitoring (Sentry). The readable-stack-trace upload only happens at build time,
// and only when the build has an auth token; nothing is uploaded from a local machine.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
