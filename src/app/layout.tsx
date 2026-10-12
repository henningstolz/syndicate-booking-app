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
  // Lets the page use the whole screen when it runs full screen from the home screen;
  // pages then keep clear of the status bar with env(safe-area-inset-top).
  viewportFit: "cover",
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
