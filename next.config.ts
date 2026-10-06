import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The message board used to be /squawks, and for a while the Notes tab
      // of the tech log. Keep old links and bookmarks working.
      {
        source: "/:groupSlug/squawks",
        destination: "/:groupSlug/board",
        permanent: false,
      },
      {
        source: "/:groupSlug/tech-log",
        has: [{ type: "query", key: "view", value: "notes" }],
        destination: "/:groupSlug/board",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
