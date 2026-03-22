import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Authentication Middleware for Route Protection
 * 
 * This middleware protects specified routes from unauthenticated access.
 * Unauthenticated users are redirected to /login page.
 */

export default withAuth(
  function middleware(req) {
    // If we reach here, user is authenticated
    // You can add additional logic here if needed (e.g., role checks)
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        // DEV MODE: Bypass auth only via explicit env var (NEVER in production)
        if (process.env.CEOCLAW_SKIP_AUTH === 'true') {
          return true;
        }
        // Check if user has a valid token (session exists)
        // Return true if authenticated, false to redirect to login
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
    // Dashboard and main application routes
    "/dashboard/:path*",
    "/projects/:path*",
    "/tasks/:path*",
    "/risks/:path*",
    "/team/:path*",
    
    // Planning and visualization routes
    "/kanban/:path*",
    "/gantt/:path*",
    "/calendar/:path*",
    
    // Settings and configuration
    "/settings/:path*",
    
    // Analytics and reporting
    "/analytics/:path*",
    "/reports/:path*",
    "/work-reports/:path*",
    
    // Integrations
    "/integrations/:path*",
    
    // Pilot program routes
    "/command-center/:path*",
    "/pilot-controls/:path*",
    "/pilot-feedback/:path*",
    "/pilot-review/:path*",
    
    // Tenant management
    "/tenant-onboarding/:path*",
    "/tenant-readiness/:path*",
    "/tenant-rollout-packet/:path*", // P1-4: Added missing route
    
    // Audit and compliance
    "/audit-packs/:path*",
    
    // Briefs and meetings
    "/briefs/:path*",
    "/meetings/:path*",
    
    // Communication
    "/chat/:path*",
    
    // Documents
    "/documents/:path*",
    "/notifications/:path*",
    "/milestones/:path*",
    "/time-entries/:path*",
    "/boards/:path*",
  ],
};
