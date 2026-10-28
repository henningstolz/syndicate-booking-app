import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { GENERAL_EMAIL, SUPPORT_EMAIL, legalDocsLive } from "@/lib/legal";

const CONTACT_EMAIL = GENERAL_EMAIL;

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1160px] px-6 pt-8 pb-10">
      <div className="mb-3.5 flex flex-wrap justify-between gap-4">
        <p className="flex items-center gap-2 font-mono text-sm font-semibold">
          <BrandMark size={22} className="shrink-0" />
          <span>
            blocktime<span className="font-normal text-bt-muted">.group</span>
          </span>
        </p>
        <div className="flex flex-wrap gap-[22px] text-sm text-bt-muted">
          <Link
            href="/login"
            className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
          >
            Sign in
          </Link>
          <Link
            href="/privacy"
            className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
          >
            Privacy
          </Link>
          {legalDocsLive() && (
            <Link
              href="/terms"
              className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
            >
              Terms
            </Link>
          )}
          <span>
            Support:{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
            >
              {SUPPORT_EMAIL}
            </a>
          </span>
          <span>
            Contact:{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
            >
              {CONTACT_EMAIL}
            </a>
          </span>
        </div>
      </div>
      <p className="max-w-[720px] text-[13px] text-bt-muted">
        Blocktime is a scheduling convenience. It is not an authoritative
        source for flight planning, aircraft airworthiness or maintenance
        status.
      </p>
    </footer>
  );
}
