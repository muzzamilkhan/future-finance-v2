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

  // The root path serves the public marketing home page to logged-out visitors;
  // `app/page.tsx` renders the dashboard only when a session is present. Everything
  // else is authed-only and redirects to sign-in.
  if (req.nextUrl.pathname === "/") return NextResponse.next();

  return NextResponse.redirect(new URL("/api/auth/signin?callbackUrl=/", req.url));
}

export const config = {
  // Run on all routes except auth/trpc API and Next internals/static assets.
  matcher: [
    "/((?!api/auth|api/trpc|_next/static|_next/image|favicon.ico).*)",
  ],
};
