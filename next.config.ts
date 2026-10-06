import type { NextConfig } from "next";

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

export default nextConfig;
