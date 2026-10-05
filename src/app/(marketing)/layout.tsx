import { Hanken_Grotesk } from "next/font/google";

// Fonts are scoped to the element they're applied to, so loading this
// here gives the public homepage its own typeface while the app itself
// (root layout) keeps Inter. IBM Plex Mono comes from the root layout.
const hanken = Hanken_Grotesk({ subsets: ["latin"], display: "swap" });

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${hanken.className} flex-1 bg-bt-paper text-[17px] leading-[1.55] text-bt-ink`}
    >
      {children}
    </div>
  );
}
