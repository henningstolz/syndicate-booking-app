// Opening a PDF from the app installed on a phone's home screen.
//
// In the installed ("standalone") app there is no browser bar and no back button, so a
// PDF that simply opens fills the screen and there is no way back. Instead the PDF is
// fetched and handed to the phone's share sheet (Save to Files, Print, Mail, WhatsApp,
// AirDrop...), which is a small popup that closes back to the app. In an ordinary
// browser the link works as a plain link. Browser-only helpers, kept apart so they can
// be read in one place.

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithFlag = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithFlag.standalone === true;
}

export function canShareFiles(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function";
}

// Fetches a file from our own server (the person's session cookie goes along).
export async function fetchFile(href: string, fileName: string): Promise<File | null> {
  try {
    const response = await fetch(href, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type || "application/pdf" });
  } catch {
    return null;
  }
}

export type ShareOutcome = "shared" | "cancelled" | "blocked" | "unsupported";

// Shows the share sheet. "blocked" means the phone wanted a fresh tap (it only allows the
// sheet soon after a tap, and fetching took too long): the file is ready, ask again.
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (!canShareFiles() || !navigator.canShare({ files: [file] })) return "unsupported";
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError") return "blocked";
    return "unsupported";
  }
}
