import type { MetadataRoute } from "next";

// What makes Blocktime installable ("Add to Home Screen"): its name, how it opens,
// its colours and icons. It opens through /open, which sends a signed-in member to
// their group and everyone else to the sign-in page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Blocktime",
    short_name: "Blocktime",
    description: "Booking, tech log and costs for your flying group.",
    start_url: "/open",
    scope: "/",
    display: "standalone",
    background_color: "#f4f5f0",
    theme_color: "#16242c",
    icons: [
      { src: "/pwa-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
