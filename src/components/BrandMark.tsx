import { AMBER, BLADE, BLADE_ANGLES, BLADE_TRANSFORM, DROP, HUB_RADIUS, NIGHT, PAPER } from "@/lib/brand-mark";

// The small Blocktime logo for page headers: the app icon with rounded corners, so it
// is recognisable as the icon on the phone's home screen. Decorative by default (it
// sits next to the name); give it a `label` when it stands alone, for example as a link.
export function BrandMark({ size = 28, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="512" height="512" rx="112" fill={NIGHT} />
      <g transform={`translate(0 ${DROP})`}>
        {BLADE_ANGLES.map((angle) => (
          <path key={angle} d={BLADE} fill={PAPER} transform={BLADE_TRANSFORM(angle)} />
        ))}
        <circle cx="256" cy="256" r={HUB_RADIUS} fill={AMBER} />
      </g>
    </svg>
  );
}
