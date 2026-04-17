import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/get-session";
import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import {
  canAccessWorkspace,
  hasPermission,
  resolveAccessibleWorkspace,
  type PlatformPermission,
  type PlatformWorkspaceId,
} from "@/lib/policy/access";
import { jsonError } from "@/lib/server/api-utils";
import { checkRateLimit } from "@/lib/rate-limit";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function isPreviewDeployment() {
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "preview";
}

function isLocalAppUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".local")
    );
  } catch {
    return /localhost|127\.0\.0\.1/.test(value);
  }
}

function getDefaultApiKey() {
  return process.env.DASHBOARD_API_KEY;
}

function isSafePreviewMethod(method: string | null | undefined) {
  return method === "GET" || method === "HEAD";
}

function shouldSkipAuth(request?: NextRequest) {
  if (process.env.CEOCLAW_SKIP_AUTH !== "true") {
    return false;
  }

  if (!isProduction()) {
    return true;
  }

  if (isPreviewDeployment()) {
    return !!request && isSafePreviewMethod(request.method);
  }

  return (
    isLocalAppUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    isLocalAppUrl(process.env.NEXTAUTH_URL)
  );
}

function shouldSkipRateLimit(request?: NextRequest) {
  if (process.env.CEOCLAW_E2E_AUTH_BYPASS === "true") {
    return true;
  }

  return shouldSkipAuth(request);
}

export interface AuthorizedRequestContext {
  accessProfile: AccessProfile;
  workspace: ReturnType<typeof resolveAccessibleWorkspace>;
}

type SessionUser = {
  id?: string;
  name?: string | null;
  role?: string | null;
  organizationSlug?: string | null;
  workspaceId?: string | null;
};

type SessionLike = {
  user?: SessionUser;
} | null;

interface AuthorizeRequestOptions {
  apiKey?: string | null;
  permission?: PlatformPermission;
  requireApiKey?: boolean;
  requireSession?: boolean;
  workspaceId?: PlatformWorkspaceId;
}

export async function authorizeRequest(
  request: NextRequest,
  options: AuthorizeRequestOptions = {}
): Promise<AuthorizedRequestContext | NextResponse> {
  // Rate limiting — apply to all API requests
  if (!shouldSkipRateLimit(request)) {
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    const { allowed, remaining } = checkRateLimit(clientIp);
    if (!allowed) {
      const res = jsonError(429, "RATE_LIMITED", "Too many requests. Please try again later.");
      res.headers.set("Retry-After", "60");
      res.headers.set("X-RateLimit-Remaining", String(remaining));
      return res;
    }
  }

  // For cron jobs and webhooks that use API keys
  if (options.requireApiKey) {
    const defaultApiKey = getDefaultApiKey();
    if (!defaultApiKey) {
      return jsonError(500, "AUTH_NOT_CONFIGURED", "DASHBOARD_API_KEY environment variable is not set.");
    }

    const authorization = request.headers.get("authorization");
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return jsonError(401, "UNAUTHORIZED", "Bearer token is required.");
    }

    const token = authorization.replace("Bearer ", "");
    const expectedApiKey = options.apiKey ?? defaultApiKey;
    if (token !== expectedApiKey) {
      return jsonError(403, "INVALID_API_KEY", "Provided bearer token is invalid.");
    }

    // API key authenticated - use system access profile
    const accessProfile = buildAccessProfile({
      role: "EXEC",
      userId: "system",
      workspaceId: "executive",
    });

    const workspace = resolveAccessibleWorkspace(
      accessProfile.role,
      options.workspaceId ?? accessProfile.workspaceId
    );

    return {
      accessProfile: { ...accessProfile, workspaceId: workspace.id },
      workspace,
    };
  }

  // For regular API routes - require session authentication
  if (!shouldSkipAuth(request) && options.requireSession !== false) {
    const session = (await getSession()) as SessionLike;

    if (!session?.user) {
      return jsonError(401, "UNAUTHORIZED", "Authentication required. Please sign in.");
    }

    if (!session.user.role) {
      return jsonError(
        403,
        "ACCOUNT_NOT_PROVISIONED",
        "This account is not provisioned for CEOClaw yet."
      );
    }

    // Build access profile from session
    const accessProfile = buildAccessProfile({
      userId: session.user.id,
      name: session.user.name,
      role: session.user.role,
      organizationSlug: session.user.organizationSlug,
      workspaceId: session.user.workspaceId ?? options.workspaceId,
    });

    if (options.workspaceId && !canAccessWorkspace(accessProfile.role, options.workspaceId)) {
      return jsonError(
        403,
        "WORKSPACE_FORBIDDEN",
        `Role ${accessProfile.role} cannot access workspace ${options.workspaceId}.`
      );
    }

    if (options.permission && !hasPermission(accessProfile.role, options.permission)) {
      return jsonError(
        403,
        "PERMISSION_DENIED",
        `Role ${accessProfile.role} does not have permission ${options.permission}.`
      );
    }

    const workspace = resolveAccessibleWorkspace(
      accessProfile.role,
      options.workspaceId ?? accessProfile.workspaceId
    );

    return {
      accessProfile: { ...accessProfile, workspaceId: workspace.id },
      workspace,
    };
  }

  // Skip auth mode (development only) - NOT RECOMMENDED for production
  if (shouldSkipAuth(request)) {
    console.warn("⚠️ CEOCLAW_SKIP_AUTH is enabled. This should NOT be used in production!");
    const accessProfile = buildAccessProfile();
    const workspace = resolveAccessibleWorkspace(
      accessProfile.role,
      options.workspaceId ?? accessProfile.workspaceId
    );
    return {
      accessProfile: { ...accessProfile, workspaceId: workspace.id },
      workspace,
    };
  }

  // Default: deny access
  return jsonError(401, "UNAUTHORIZED", "Authentication required.");
}

export function withAuth(
  req: NextRequest,
  _res: NextResponse,
  next: () => void
) {
  // This sync wrapper is deprecated - use authorizeRequest directly
  console.warn("⚠️ withAuth() is deprecated. Use authorizeRequest() instead.");
  next();
}
