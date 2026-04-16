// Unified Actor context — resolves User (NextAuth) or Agent (API key)

import { getServerSession } from "next-auth";
import { resolveAgentByApiKey } from "./agent-service";
import type { Actor } from "./types";
import type { NextRequest } from "next/server";

/**
 * Resolve the actor from the request.
 * 1. Bearer sk-agent-... → Agent API key → Actor(agent)
 * 2. NextAuth session → Actor(user)
 * 3. null if unauthenticated
 */
export async function resolveActor(req: NextRequest): Promise<Actor | null> {
  // 1. Check for Agent API key
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer sk-agent-")) {
    const plainKey = authHeader.slice(7); // "Bearer " = 7 chars
    const resolved = await resolveAgentByApiKey(plainKey);
    if (resolved) {
      return {
        type: "agent",
        id: resolved.agentId,
        workspaceId: resolved.workspaceId,
        definitionId: resolved.definitionId,
      };
    }
    return null; // invalid agent key
  }

  // 2. Check NextAuth session
  const session = await getServerSession();
  if (session?.user?.id) {
    // Workspace from header or query — agents are workspace-scoped
    const workspaceId =
      req.headers.get("x-workspace-id") ??
      req.nextUrl.searchParams.get("workspaceId") ??
      "executive";

    return {
      type: "user",
      id: session.user.id,
      workspaceId,
    };
  }

  return null;
}

/**
 * Guard: require any authenticated actor
 */
export function requireActor(actor: Actor | null): asserts actor is Actor {
  if (!actor) {
    throw new Error("Unauthorized");
  }
}

/**
 * Guard: require a user (not an agent)
 */
export function requireUser(
  actor: Actor | null
): asserts actor is Actor & { type: "user" } {
  if (!actor || actor.type !== "user") {
    throw new Error("User authentication required");
  }
}
