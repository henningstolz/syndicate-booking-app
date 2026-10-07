import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { DEMO_HEADER } from "@/lib/demo/header";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDemo = pathname === "/demo" || pathname.startsWith("/demo/");

  // Only this proxy decides what is the demo: drop any such header a visitor
  // sent, then set it for demo addresses only.
  request.headers.delete(DEMO_HEADER);
  if (isDemo) {
    request.headers.set(DEMO_HEADER, "1");
    // The demo has no sign-in and never talks to the database.
    return NextResponse.next({ request });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
