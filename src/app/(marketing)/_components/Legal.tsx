import Link from "next/link";
import { Eyebrow } from "./Eyebrow";
import { Footer } from "./Footer";

// The shared frame of the terms and privacy pages: the header, the title block with its version,
// the sections, and the website footer.
export function LegalShell({
  eyebrow,
  title,
  intro,
  version,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b border-bt-line bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 px-6 py-[18px]">
          <Link href="/" className="font-mono text-xl font-semibold tracking-[0.01em] no-underline">
            blocktime<span className="font-normal text-bt-muted">.group</span>
          </Link>
          <Link href="/login" className="flex min-h-11 items-center text-[15px] hover:underline">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-6 pt-16 pb-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mb-5 text-[clamp(34px,4.6vw,52px)] leading-[1.06] font-bold tracking-[-0.02em]">{title}</h1>
        <p className="text-[19px] text-bt-muted">{intro}</p>
        <p className="mt-4 font-mono text-[13px] text-bt-muted">Version {version}</p>
        {children}
      </main>

      <Footer />
    </>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-3.5 text-[26px] leading-[1.2] font-bold tracking-[-0.01em]">{title}</h2>
      <div className="space-y-3.5 text-bt-muted [&_li]:mt-2 [&_strong]:font-semibold [&_strong]:text-bt-ink [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}

// A statement that has not been checked yet. It shows as a highlighted [REVIEW] note in the text, so it
// cannot be missed, and goes when the text has been reviewed.
export function Review({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-amber-100 px-1 py-0.5 text-[0.85em] font-medium text-amber-900">[REVIEW: {children}]</mark>
  );
}

export function MailLink({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="text-bt-ink underline underline-offset-4 hover:text-bt-blue">
      {address}
    </a>
  );
}
