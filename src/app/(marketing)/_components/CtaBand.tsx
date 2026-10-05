import { LinkButton } from "./LinkButton";

export function CtaBand() {
  return (
    <section className="bg-bt-ink text-bt-paper">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-8 px-6 py-20">
        <h2 className="max-w-[560px] text-[clamp(30px,4vw,46px)] leading-[1.08] font-bold tracking-[-0.015em]">
          Give your group a better calendar.
        </h2>
        <div className="flex flex-wrap gap-3.5">
          <LinkButton href="/login" variant="light" size="lg">
            Create your group
          </LinkButton>
          <LinkButton href="/login" variant="outline" size="lg">
            Sign in
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
