import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next-path";

// Supabase's default confirmation/magic-link email links through its
// own verify endpoint, which then redirects here with a `code` (the
// `emailRedirectTo` we pass at sign-up time) rather than a ready-made
// session — we exchange it for one and set the cookies ourselves.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // A password-reset link that no longer works gets its own explanation.
  if (next.startsWith("/reset-password")) {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }
  return NextResponse.redirect(`${origin}/login?error=confirmation-failed`);
}
