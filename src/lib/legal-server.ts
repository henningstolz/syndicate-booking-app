import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoRequest } from "@/lib/demo/mode";
import { ACCEPT_PATH, PRIVACY_VERSION, TERMS_VERSION, acceptedAtSignUp, hasAcceptedCurrent, legalDocsLive, type Acceptance } from "@/lib/legal";

// The server side of the terms: who has accepted what, and the one-time screen for people who have
// not. Does nothing at all unless the legal switch (LEGAL_DOCS_LIVE) is on. See src/lib/legal.ts.

const CURRENT: Acceptance[] = [
  { document: "terms", version: TERMS_VERSION },
  { document: "privacy", version: PRIVACY_VERSION },
];

// Writes this person's acceptance of the current versions (only the ones not already recorded).
// `groupId` is set when a group is created. Returns false if the database refused.
export async function recordAcceptance(supabase: SupabaseClient, userId: string, groupId: string | null): Promise<boolean> {
  const { data: existing } = await supabase
    .from("terms_acceptances")
    .select("document, version, group_id")
    .eq("user_id", userId)
    .in("version", [TERMS_VERSION, PRIVACY_VERSION]);
  const have = (existing ?? []).filter((row) => (row.group_id ?? null) === groupId);
  const rows = CURRENT
    .filter((doc) => !have.some((row) => row.document === doc.document && row.version === doc.version))
    .map((doc) => ({ user_id: userId, group_id: groupId, document: doc.document, version: doc.version }));
  if (rows.length === 0) return true;
  const { error } = await supabase.from("terms_acceptances").insert(rows);
  return !error;
}

// Call this at the top of any signed-in page. If the person has not accepted the current terms and
// privacy text it sends them to the acceptance screen, or (when they ticked the box at sign-up) records
// that tick and carries on.
export async function ensureTermsAccepted(
  supabase: SupabaseClient,
  user: { id: string; user_metadata?: unknown },
  nextPath: string,
): Promise<void> {
  if (!legalDocsLive() || (await isDemoRequest())) return;

  const { data } = await supabase
    .from("terms_acceptances")
    .select("document, version")
    .eq("user_id", user.id)
    .in("version", [TERMS_VERSION, PRIVACY_VERSION]);
  if (hasAcceptedCurrent(data ?? [])) return;

  if (acceptedAtSignUp(user.user_metadata) && (await recordAcceptance(supabase, user.id, null))) return;

  redirect(`${ACCEPT_PATH}?next=${encodeURIComponent(nextPath)}`);
}
