// Class names are written out in full (not built from a colour name)
// so Tailwind's scanner can see them.
const PALETTE = [
  { dot: "bg-amber-500", border: "border-l-amber-500", stroke: "stroke-amber-500" },
  { dot: "bg-teal-500", border: "border-l-teal-500", stroke: "stroke-teal-500" },
  { dot: "bg-indigo-500", border: "border-l-indigo-500", stroke: "stroke-indigo-500" },
  { dot: "bg-rose-500", border: "border-l-rose-500", stroke: "stroke-rose-500" },
  { dot: "bg-lime-600", border: "border-l-lime-600", stroke: "stroke-lime-600" },
  { dot: "bg-sky-500", border: "border-l-sky-500", stroke: "stroke-sky-500" },
];

export function memberColor(index: number) {
  return PALETTE[index % PALETTE.length];
}

// Neutral colour for a chart's folded "everyone else" bucket.
export const OTHER_COLOR = { dot: "bg-zinc-400", stroke: "stroke-zinc-400" };
