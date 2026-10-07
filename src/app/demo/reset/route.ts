import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo/overlay";

// "Reset demo": forget the visitor's own demo changes and start again.
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/demo", request.url));
  response.cookies.set(DEMO_COOKIE, "", { path: "/demo", maxAge: 0 });
  return response;
}
