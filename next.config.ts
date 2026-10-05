import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The page used to live at /squawks; keep old links and bookmarks working.
      {
        source: "/:groupSlug/squawks",
        destination: "/:groupSlug/tech-log",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
