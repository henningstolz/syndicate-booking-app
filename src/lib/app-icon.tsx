// The Blocktime app icon, drawn from shapes (no fonts, so it renders the same
// everywhere): a three-blade propeller seen from the front, with an amber spinner,
// in the site's off-white and amber on its night colour. The artwork stays within
// about 190 units of the centre of the 512-unit square, inside the circle (205) a
// phone may cut out of it ("maskable" icons).
const NIGHT = "#16242c";
const PAPER = "#f4f5f0";
const AMBER = "#b97327";

// One blade, pointing up from the hub at (256, 256), tip at the top.
const BLADE = "M228 262C214 205 208 150 226 98C234 74 278 74 286 98C304 150 298 205 284 262Z";
const BLADE_SCALE = 0.88;
// A three-blade prop sits high in its square (one blade up, two down), so it is moved
// down to look centred.
const DROP = 34;

export function AppIcon({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, display: "flex" }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512">
        <rect width="512" height="512" fill={NIGHT} />
        <g transform={`translate(0 ${DROP})`}>
          {[0, 120, 240].map((angle) => (
            <path
              key={angle}
              d={BLADE}
              fill={PAPER}
              transform={`translate(256 256) rotate(${angle}) scale(${BLADE_SCALE}) translate(-256 -256)`}
            />
          ))}
          <circle cx="256" cy="256" r="45" fill={AMBER} />
        </g>
      </svg>
    </div>
  );
}
