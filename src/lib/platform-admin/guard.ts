import type { SupabaseClient } from "@supabase/supabase-js";

// Where a visitor stands with the platform admin page. Decided on the server, from the database
// (is_platform_admin) and the sign-in strength, never from anything the browser says.
//   not_admin        signed out, or signed in but not a platform admin: the page does not exist (404)
//   needs_enrolment  a platform admin with no authenticator app yet
//   needs_code       a platform admin who must enter the code from the app
//   ok               a platform admin signed in with a code (aal2)
// Every admin_* database function checks the same thing again for itself.
export type AdminState = "not_admin" | "needs_enrolment" | "needs_code" | "ok";

export async function adminState(supabase: SupabaseClient): Promise<AdminState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "not_admin";

  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error || isAdmin !== true) return "not_admin";

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel === "aal2") {
    const { data: ok } = await supabase.rpc("platform_admin_ok");
    return ok === true ? "ok" : "needs_code";
  }
  return level?.nextLevel === "aal2" ? "needs_code" : "needs_enrolment";
}
