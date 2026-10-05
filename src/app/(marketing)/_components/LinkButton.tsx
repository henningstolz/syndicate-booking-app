import Link from "next/link";

// For use on the dark hero and CTA band (the focus ring is the light
// paper colour for that reason).
const base =
  "inline-flex items-center font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-bt-paper";

const variants = {
  light: "bg-bt-paper text-bt-ink hover:bg-white",
  ghost:
    "border border-[rgba(244,245,240,0.7)] text-bt-paper hover:bg-[rgba(244,245,240,0.14)]",
  outline:
    "border border-bt-neutral text-bt-paper hover:bg-[rgba(244,245,240,0.14)]",
};

const sizes = {
  sm: "min-h-11 px-5 text-[15px]",
  lg: "min-h-[52px] px-7 text-[17px]",
};

export function LinkButton({
  href,
  variant,
  size,
  children,
}: {
  href: string;
  variant: keyof typeof variants;
  size: keyof typeof sizes;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]}`}>
      {children}
    </Link>
  );
}
