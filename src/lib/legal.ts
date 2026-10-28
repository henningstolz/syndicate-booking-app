// The terms and privacy versions, the support address, and the rule for who must accept. Pure, so
// the tests can run it in plain Node.
//
// VERSIONS: change a version string whenever its page changes in a way people should agree to
// again. Everyone is then asked to accept at their next page load. While the text is still a draft
// the version ends in "-draft"; replace it with the date when the reviewed text goes live.
export const TERMS_VERSION = "2026-11-draft1";
export const PRIVACY_VERSION = "2026-11-draft1";

export const SUPPORT_EMAIL = "support@blocktime.group";
export const GENERAL_EMAIL = "hello@blocktime.group";

// The switch. Terms, the new privacy text, the sign-up checkbox and the acceptance screen exist only
// where LEGAL_DOCS_LIVE=1 (Vercel). Anywhere else the app behaves as it did before they were built.
export function legalDocsLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.LEGAL_DOCS_LIVE === "1";
}

export type Acceptance = { document: string; version: string };

// Has this person accepted the CURRENT version of both documents?
export function hasAcceptedCurrent(accepted: Acceptance[]): boolean {
  const has = (document: string, version: string) => accepted.some((a) => a.document === document && a.version === version);
  return has("terms", TERMS_VERSION) && has("privacy", PRIVACY_VERSION);
}

// What the sign-up form stores with the account (user_metadata) when the box is ticked.
export const acceptanceMetadata = () => ({ accepted_terms: TERMS_VERSION, accepted_privacy: PRIVACY_VERSION });

// Did the person tick the box for the current versions at sign-up?
export function acceptedAtSignUp(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null) return false;
  const m = metadata as Record<string, unknown>;
  return m.accepted_terms === TERMS_VERSION && m.accepted_privacy === PRIVACY_VERSION;
}

// Only ever send people to a page on this site after accepting.
export const ACCEPT_PATH = "/accept-terms";
