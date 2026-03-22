/**
 * API Authentication Wrappers
 *
 * Provides authentication middleware for API routes
 * Supports both session-based auth (NextAuth) and API key auth (system/cron)
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/auth-options";
import { logger } from "@/lib/logger";

export interface AuthenticatedContext {
  session: {
    user: {
      id: string;
      role?: string;
      email?: string;
    };
  };
  params?: Record<string, string>;
}

type AuthenticatedHandler = (
  req: NextRequest,
  context: AuthenticatedContext
) => Promise<NextResponse>;

/**
 * Session-based authentication wrapper
 * Use for user-initiated API calls
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest, routeContext?: { params: Record<string, string> }) => {
    // Dev bypass
    if (process.env.CEOCLAW_SKIP_AUTH === "true" && process.env.NODE_ENV === "development") {
      logger.debug("[withAuth] Dev mode: skipping auth");
      const mockSession = {
        user: {
          id: "dev-user",
          role: "admin",
          email: "dev@example.com",
        },
      };
      return handler(req, { session: mockSession, params: routeContext?.params });
    }

    try {
      const session = await getServerSession(authOptions);

      if (!session?.user) {
        logger.warn("[withAuth] Unauthorized access attempt");
        return NextResponse.json(
          { error: "Unauthorized", code: "AUTH_REQUIRED" },
          { status: 401 }
        );
      }

      return handler(req, { session, params: routeContext?.params });
    } catch (error) {
      logger.error("[withAuth] Auth check failed:", error);
      return NextResponse.json(
        { error: "Authentication failed", code: "AUTH_ERROR" },
        { status: 500 }
      );
    }
  };
}

/**
 * API Key authentication wrapper
 * Use for system calls, cron jobs, webhooks
 */
export function withApiKey(handler: AuthenticatedHandler) {
  return async (req: NextRequest, routeContext?: { params: Record<string, string> }) => {
    const authHeader = req.headers.get("authorization");
    const apiKey = authHeader?.replace("Bearer ", "");

    if (!apiKey) {
      logger.warn("[withApiKey] Missing API key");
      return NextResponse.json(
        { error: "API key required", code: "API_KEY_REQUIRED" },
        { status: 401 }
      );
    }

    const validApiKey = process.env.DASHBOARD_API_KEY;

    if (!validApiKey || apiKey !== validApiKey) {
      logger.warn("[withApiKey] Invalid API key");
      return NextResponse.json(
        { error: "Invalid API key", code: "INVALID_API_KEY" },
        { status: 401 }
      );
    }

    const systemSession = {
      user: {
        id: "system",
        role: "system",
        email: "system@ceoclaw.local",
      },
    };

    return handler(req, { session: systemSession, params: routeContext?.params });
  };
}

/**
 * Combined auth wrapper
 * Accepts either session OR API key
 */
export function withOptionalAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest, routeContext?: { params: Record<string, string> }) => {
    // Dev bypass
    if (process.env.CEOCLAW_SKIP_AUTH === "true" && process.env.NODE_ENV === "development") {
      const mockSession = { user: { id: "dev-user", role: "admin" } };
      return handler(req, { session: mockSession, params: routeContext?.params });
    }

    // Try API key first
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const apiKey = authHeader.replace("Bearer ", "");
      const validApiKey = process.env.DASHBOARD_API_KEY;

      if (validApiKey && apiKey === validApiKey) {
        const systemSession = { user: { id: "system", role: "system" } };
        return handler(req, { session: systemSession, params: routeContext?.params });
      }
    }

    // Fall back to session auth
    try {
      const session = await getServerSession(authOptions);

      if (session?.user) {
        return handler(req, { session, params: routeContext?.params });
      }
    } catch (error) {
      logger.error("[withOptionalAuth] Session check failed:", error);
    }

    // No valid auth
    return NextResponse.json(
      { error: "Authentication required", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  };
}

/**
 * Role-based access control
 * Use with withAuth or withOptionalAuth
 */
export function requireRole(allowedRoles: string[]) {
  return (
    handler: AuthenticatedHandler
  ): ((req: NextRequest, context?: { params: Record<string, string> }) => Promise<NextResponse>) => {
    return async (req: NextRequest, context?: { params: Record<string, string> }) => {
      // This should be wrapped with withAuth first
      const session = await getServerSession(authOptions);

      if (!session?.user) {
        return NextResponse.json(
          { error: "Unauthorized", code: "AUTH_REQUIRED" },
          { status: 401 }
        );
      }

      const userRole = session.user.role || "user";

      if (!allowedRoles.includes(userRole)) {
        logger.warn(`[requireRole] Access denied for role: ${userRole}`);
        return NextResponse.json(
          { error: "Insufficient permissions", code: "FORBIDDEN" },
          { status: 403 }
        );
      }

      return handler(req, {
        session,
        params: context?.params,
      });
    };
  };
}
