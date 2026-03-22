import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { isPublicAppPath } from "@/lib/public-paths";

/**
 * Authentication Middleware for Route Protection
 * 
 * This middleware protects specified routes from unauthenticated access.
 * Unauthenticated users are redirected to /login page.
 */

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        // DEV MODE: Bypass auth only via explicit env var (NEVER in production)
        if (process.env.CEOCLAW_SKIP_AUTH === 'true') {
          return true;
        }

        if (isPublicAppPath(req.nextUrl.pathname)) {
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
