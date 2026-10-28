import Link from "next/link";

// The required box shown at sign-up, group creation and the acceptance screen (only where the legal
// switch is on). The links open in a new tab so nothing typed is lost.
export function AcceptTermsCheckbox() {
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-700">
      <input type="checkbox" name="acceptTerms" required className="mt-1 h-4 w-4" />
      <span>
        I accept the{" "}
        <Link href="/terms" target="_blank" className="underline underline-offset-4">Terms</Link>
        {" "}and have read the{" "}
        <Link href="/privacy" target="_blank" className="underline underline-offset-4">Privacy page</Link>.
      </span>
    </label>
  );
}
