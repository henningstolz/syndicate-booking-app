import { Eyebrow } from "./Eyebrow";

const STEPS = [
  { title: "Create your group", text: "Name it and add your aircraft." },
  { title: "Invite your members", text: "Bring in the people you fly with." },
  { title: "Book your first flight", text: "Pick a slot. Everyone sees it straight away." },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1160px] px-6 py-[88px]">
      <Eyebrow>HOW IT WORKS</Eyebrow>
      <h2 className="mb-12 max-w-[640px] text-[clamp(30px,3.6vw,42px)] leading-[1.1] font-bold tracking-[-0.015em]">
        From sign-up to first booking in a few minutes.
      </h2>
      <ol className="flex flex-wrap border-t border-bt-ink">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="min-w-0 flex-[1_1_260px] border-b border-bt-grid py-7 pr-7 last:pr-0"
          >
            <p className="mb-3.5 font-mono text-sm text-bt-muted">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h3 className="mb-2 text-[21px] font-semibold">{step.title}</h3>
            <p className="text-bt-muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
