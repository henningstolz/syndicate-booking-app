import { AMBER, BLADE, BLADE_ANGLES, BLADE_TRANSFORM, DROP, HUB_RADIUS, NIGHT, PAPER } from "@/lib/brand-mark";

// The Blocktime app icon as a full square (phones round or crop it themselves),
// drawn from the shared mark in src/lib/brand-mark.ts. The artwork stays within
// about 190 units of the centre of the 512-unit square, inside the circle (205) a
// phone may cut out of it ("maskable" icons). Used by the home-screen, browser-tab
// and iPhone icons.
export function AppIcon({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, display: "flex" }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512">
        <rect width="512" height="512" fill={NIGHT} />
        <g transform={`translate(0 ${DROP})`}>
          {BLADE_ANGLES.map((angle) => (
            <path key={angle} d={BLADE} fill={PAPER} transform={BLADE_TRANSFORM(angle)} />
          ))}
          <circle cx="256" cy="256" r={HUB_RADIUS} fill={AMBER} />
        </g>
      </svg>
    </div>
  );
}
