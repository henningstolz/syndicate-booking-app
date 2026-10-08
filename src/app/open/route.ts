import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { homePathFor } from "@/lib/user-home";

// Where the installed app opens: a signed-in member lands on their group (the one
// they used last), anyone else on the sign-in page.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const target = user ? await homePathFor(supabase, user.id) : "/login";
  return NextResponse.redirect(new URL(target, request.url));
}
