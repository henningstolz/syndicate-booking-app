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

// The proxy refreshes the sign-in session and marks the demo. Every request it runs on is a
// function invocation that costs CPU time, so it skips what needs neither: Next's own files,
// images, the hero video, the manifest and icons, the uptime check, the daily jobs, calendar
// feeds, and the public pages that are built in advance (home, terms, privacy). Everything
// else (sign-in, the app, the demo) still goes through it.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/health$|api/monitoring-check$|api/cron/|cal/|pwa-icon/|icon$|apple-icon$|privacy$|terms$|$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|ico|webmanifest|txt)$).*)",
  ],
};
