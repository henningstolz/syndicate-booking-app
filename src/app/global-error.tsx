"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

// Shown when the page itself breaks badly (an error in the layout that every page shares).
// It reports the error and gives the person a way forward instead of a blank screen.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: "48px 24px", background: "#f4f5f0", color: "#172026", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }}>
        <main style={{ maxWidth: 420, margin: "0 auto" }}>
          <p style={{ margin: "0 0 20px", fontFamily: "Menlo, Consolas, monospace", fontSize: 13, color: "#4f5a54" }}>blocktime</p>
          <h1 style={{ margin: "0 0 12px", fontSize: 22 }}>Something went wrong.</h1>
          <p style={{ margin: "0 0 24px", lineHeight: 1.5 }}>The problem has been reported. Please reload the page. If it keeps happening, write to support@blocktime.group.</p>
          <Link href="/" style={{ display: "inline-block", padding: "12px 22px", background: "#172026", color: "#f4f5f0", textDecoration: "none", borderRadius: 999, fontWeight: 600, fontSize: 15 }}>
            Back to Blocktime
          </Link>
        </main>
      </body>
    </html>
  );
}
