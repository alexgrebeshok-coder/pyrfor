import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { isPublicAuthPath } from "@/lib/public-paths";

/**
 * Authentication Middleware for Route Protection
 * 
 * This middleware protects specified routes from unauthenticated access.
 * Unauthenticated users are redirected to /login page.
 */

function isLocalE2ETestBypassEnabled(hostname: string): boolean {
  if (process.env.CEOCLAW_E2E_AUTH_BYPASS !== "true") {
    return false;
  }

  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "0.0.0.0" ||
    normalizedHostname === "[::1]"
  );
}

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        // DEV MODE: Bypass auth only via explicit env var (NEVER in production)
        if (process.env.CEOCLAW_SKIP_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
          return true;
        }

        // Allow Playwright smoke to exercise a local production-like server only via explicit opt-in.
        if (isLocalE2ETestBypassEnabled(req.nextUrl.hostname)) {
          return true;
        }

        if (isPublicAuthPath(req.nextUrl.pathname)) {
          return true;
        }

        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

/**
 * Configure which routes to protect
 * Routes NOT in this list will be public
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|apple-touch-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|offline.html|sw.js).*)",
  ],
};
