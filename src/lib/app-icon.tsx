// The Blocktime app icon, drawn from shapes (no fonts, so it renders the same
// everywhere): the lowercase "b" of the wordmark with a booking block at the top
// of its stem, in the site's night, paper and amber colours. The artwork sits
// inside the central 60% of the square, so it also survives the circle or rounded
// shape a phone cuts out of it ("maskable" icons).
const NIGHT = "#16242c";
const PAPER = "#f4f5f0";
const AMBER = "#b97327";

// Everything is laid out on a 512-unit square and scaled to the size asked for.
export function AppIcon({ size }: { size: number }) {
  const u = (n: number) => (n * size) / 512;
  // `radius` is one number, or [top-left, top-right, bottom-right, bottom-left].
  const box = (x: number, y: number, w: number, h: number, radius: number | number[], color: string) => (
    <div
      style={{
        position: "absolute",
        left: u(x),
        top: u(y),
        width: u(w),
        height: u(h),
        borderRadius: (Array.isArray(radius) ? radius : [radius]).map((r) => `${u(r)}px`).join(" "),
        background: color,
      }}
    />
  );
  return (
    <div style={{ width: size, height: size, display: "flex", position: "relative", background: NIGHT }}>
      {box(168, 120, 52, 272, 12, PAPER) /* the stem of the b */}
      {box(168, 236, 176, 156, [0, 52, 52, 0], PAPER) /* the bowl, solid and joined to the stem... */}
      {box(220, 288, 72, 52, 20, NIGHT) /* ...with its counter cut out */}
      {box(244, 120, 100, 52, 12, AMBER) /* a booking block on the board */}
    </div>
  );
}
