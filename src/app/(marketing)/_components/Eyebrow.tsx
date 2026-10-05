// The small monospace label above each section heading.
export function Eyebrow({
  children,
  className = "text-bt-blue",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`mb-3.5 font-mono text-[13px] tracking-[0.04em] ${className}`}>
      {children}
    </p>
  );
}
