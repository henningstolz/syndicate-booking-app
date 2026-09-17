const PALETTE = [
  { dot: "bg-amber-500", border: "border-l-amber-500" },
  { dot: "bg-teal-500", border: "border-l-teal-500" },
  { dot: "bg-indigo-500", border: "border-l-indigo-500" },
  { dot: "bg-rose-500", border: "border-l-rose-500" },
  { dot: "bg-lime-600", border: "border-l-lime-600" },
  { dot: "bg-sky-500", border: "border-l-sky-500" },
];

export function memberColor(index: number) {
  return PALETTE[index % PALETTE.length];
}
