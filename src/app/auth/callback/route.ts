import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase's default confirmation/magic-link email links through its
// own verify endpoint, which then redirects here with a `code` (the
// `emailRedirectTo` we pass at sign-up time) rather than a ready-made
// session — we exchange it for one and set the cookies ourselves.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/login";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirmation-failed`);
}
