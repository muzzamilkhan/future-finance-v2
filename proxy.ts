import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Names NextAuth v5 uses for the session cookie (secure prefix in production).
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function proxy(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on all routes except the login page, auth/trpc API, and Next internals/static assets.
  matcher: [
    "/((?!login|api/auth|api/trpc|_next/static|_next/image|favicon.ico).*)",
  ],
};
