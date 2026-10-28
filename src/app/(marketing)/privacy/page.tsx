import type { Metadata } from "next";
import { legalDocsLive } from "@/lib/legal";
import PrivacyCurrent from "./PrivacyCurrent";
import PrivacyDraft from "./PrivacyDraft";

export const metadata: Metadata = {
  title: "Privacy: Blocktime",
  description:
    "What Blocktime stores about you, who can see it, and how to have it corrected or deleted.",
};

// Until the legal switch (LEGAL_DOCS_LIVE=1) is on, the text that has always been live is shown; with
// it on, the new versioned text (with its [REVIEW] notes until it has been checked).
export default function PrivacyPage() {
  return legalDocsLive() ? <PrivacyDraft /> : <PrivacyCurrent />;
}
