import type { Metadata } from "next";
import { BoardSection } from "./_components/BoardSection";
import { CtaBand } from "./_components/CtaBand";
import { Features } from "./_components/Features";
import { Footer } from "./_components/Footer";
import { Hero } from "./_components/Hero";
import { HowItWorks } from "./_components/HowItWorks";
import { PrivacyAbout } from "./_components/PrivacyAbout";

export const metadata: Metadata = {
  title: "Blocktime: booking, squawks and costs for your flying group",
  description:
    "One calendar everyone trusts, for the people you share an aircraft with. Built for a phone in one hand at the airfield.",
};

export default function HomePage() {
  return (
    <>
      <main>
        <Hero />
        <BoardSection />
        <Features />
        <HowItWorks />
        <PrivacyAbout />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
