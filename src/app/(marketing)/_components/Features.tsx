import { Eyebrow } from "./Eyebrow";

const FEATURES = [
  {
    status: "Live",
    title: "Booking calendar",
    text: "See the whole week at a glance. Book a slot in seconds, and clashes are caught before they happen.",
  },
  {
    status: "Live",
    title: "Squawk log",
    text: "Anyone can log a defect. Everyone sees what is open, so the next pilot knows before walking out to the aircraft.",
  },
  {
    status: "Next",
    title: "Hours and costs",
    text: "Hobbs in and out, fuel, and a fair monthly split per member. Being built next.",
  },
];

export function Features() {
  return (
    <section className="border-y border-bt-line bg-white">
      <div className="mx-auto max-w-[1160px] px-6 py-20">
        <Eyebrow>WHAT IT DOES</Eyebrow>
        <h2 className="mb-11 max-w-[640px] text-[clamp(30px,3.6vw,42px)] leading-[1.1] font-bold tracking-[-0.015em]">
          Everything a shared aircraft needs, in one place.
        </h2>
        <div className="flex flex-wrap gap-5">
          {FEATURES.map((feature) => {
            const live = feature.status === "Live";
            return (
              <div
                key={feature.title}
                className="min-w-0 flex-[1_1_280px] border border-bt-line bg-bt-paper p-7"
              >
                <p
                  className={`mb-[18px] inline-block border px-2 py-0.5 font-mono text-xs ${
                    live
                      ? "border-bt-green-line text-bt-green"
                      : "border-bt-neutral text-bt-muted"
                  }`}
                >
                  {feature.status}
                </p>
                <h3 className="mb-2.5 text-[22px] font-semibold">{feature.title}</h3>
                <p className="text-bt-muted">{feature.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
