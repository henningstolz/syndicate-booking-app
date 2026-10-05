import Link from "next/link";
import { Eyebrow } from "./Eyebrow";
import { HeroFilm } from "./HeroFilm";
import { LinkButton } from "./LinkButton";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-bt-night text-bt-paper">
      <HeroFilm />
      {/* Darkening layer keeps the words readable over any footage. */}
      <div
        className="absolute inset-0 bg-[rgba(15,26,33,0.55)]"
        aria-hidden="true"
      />

      <div className="relative">
        <header>
          <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4 px-6 py-[22px]">
            <p className="font-mono text-xl font-semibold tracking-[0.01em]">
              blocktime<span className="font-normal text-[#c9d2cf]">.group</span>
            </p>
            <nav
              aria-label="Account"
              className="flex flex-wrap items-center gap-[22px]"
            >
              <Link
                href="/login"
                className="flex min-h-11 items-center text-[15px] text-[#e6ebe8] no-underline hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-bt-paper"
              >
                Sign in
              </Link>
              <LinkButton href="/login" variant="light" size="sm">
                Create a group
              </LinkButton>
            </nav>
          </div>
          <div className="border-t border-[rgba(244,245,240,0.28)]" />
        </header>

        <div className="mx-auto max-w-[1160px] px-6 pt-20 pb-28 sm:pt-32 sm:pb-[168px]">
          <Eyebrow className="text-[#c9d6dc]">BOOKING FOR SHARED AIRCRAFT</Eyebrow>
          <h1 className="mb-6 max-w-[820px] text-[clamp(40px,6vw,76px)] leading-[1.03] font-bold tracking-[-0.02em]">
            Booking, squawks and costs for your flying group.
          </h1>
          <p className="mb-[38px] max-w-[560px] text-[21px] leading-normal text-[#e6ebe8]">
            One calendar everyone trusts, for the people you share an aircraft
            with. Built for a phone in one hand at the airfield.
          </p>
          <div className="flex flex-wrap gap-3.5">
            <LinkButton href="/login" variant="light" size="lg">
              Create your group
            </LinkButton>
            <LinkButton href="/login" variant="ghost" size="lg">
              Sign in
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
