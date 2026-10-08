import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Blocktime",
  description: "Booking, tech log and costs for your flying group.",
  // When added to the iPhone home screen it opens full screen under this name.
  appleWebApp: { capable: true, title: "Blocktime", statusBarStyle: "default" },
};

// The colour of the browser bar and the phone's status bar.
export const viewport: Viewport = {
  themeColor: "#16242c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
