"use client";

import { useRef, useState } from "react";
import { fetchFile, isStandalone, shareFile } from "@/lib/open-file";

// A link to a PDF. In a browser it is an ordinary link. In the app installed on a phone's
// home screen (where a PDF would take over the screen with no way back) it fetches the
// file and opens the phone's share sheet instead: Save to Files, Print, Mail, WhatsApp...
export function FileLink({
  href,
  fileName,
  className,
  children,
  label,
}: {
  href: string;
  fileName: string;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ready">("idle");
  const fileRef = useRef<File | null>(null);

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isStandalone()) return; // an ordinary link
    event.preventDefault();

    // Already fetched, and the phone wanted a fresh tap: share it now.
    if (fileRef.current) {
      const outcome = await shareFile(fileRef.current);
      if (outcome === "unsupported") window.open(href, "_blank");
      setState(outcome === "blocked" ? "ready" : "idle");
      return;
    }

    setState("busy");
    const file = await fetchFile(href, fileName);
    if (!file) {
      setState("idle");
      window.open(href, "_self"); // let the browser deal with it (and show any error)
      return;
    }
    fileRef.current = file;
    const outcome = await shareFile(file);
    if (outcome === "unsupported") {
      fileRef.current = null;
      setState("idle");
      window.open(href, "_blank");
      return;
    }
    setState(outcome === "blocked" ? "ready" : "idle");
  }

  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={label}
      aria-busy={state === "busy"}
      className={className}
    >
      {state === "busy" ? "Preparing…" : state === "ready" ? "Tap to save or share" : children}
    </a>
  );
}
