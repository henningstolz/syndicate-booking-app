import { Eyebrow } from "./Eyebrow";

type Status = "Live" | "In progress" | "Next";

const FEATURES: { status: Status; title: string; text: string }[] = [
  {
    status: "Live",
    title: "Booking calendar",
    text: "See the whole week at a glance. Book a slot in seconds, and clashes are caught before they happen.",
  },
  {
    status: "Live",
    title: "Tech log",
    text: "One shared record of the aircraft: defects, hours and fixes. The next pilot knows its state before walking out to it.",
  },
  {
    status: "Live",
    title: "Hours and costs",
    text: "Block hours from the tech log, fuel shared by hours flown, and a clear statement for every member each month.",
  },
];

const STATUS_STYLES: Record<Status, string> = {
  Live: "border-bt-green-line text-bt-green",
  "In progress": "border-bt-amber-line text-bt-amber",
  Next: "border-bt-neutral text-bt-muted",
};

export function Features() {
  return (
    <section className="border-y border-bt-line bg-white">
      <div className="mx-auto max-w-[1160px] px-6 py-20">
        <Eyebrow>WHAT IT DOES</Eyebrow>
        <h2 className="mb-11 max-w-[640px] text-[clamp(30px,3.6vw,42px)] leading-[1.1] font-bold tracking-[-0.015em]">
          Everything a shared aircraft needs, in one place.
        </h2>
        <div className="flex flex-wrap gap-5">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="min-w-0 flex-[1_1_280px] border border-bt-line bg-bt-paper p-7"
            >
              <p
                className={`mb-[18px] inline-block border px-2 py-0.5 font-mono text-xs ${STATUS_STYLES[feature.status]}`}
              >
                {feature.status}
              </p>
              <h3 className="mb-2.5 text-[22px] font-semibold">{feature.title}</h3>
              <p className="text-bt-muted">{feature.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
