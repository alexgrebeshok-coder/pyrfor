"use strict";
// Unified Actor context — resolves User (NextAuth) or Agent (API key)
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveActor = resolveActor;
exports.requireActor = requireActor;
exports.requireUser = requireUser;
const next_auth_1 = require("next-auth");
const agent_service_1 = require("./agent-service");
/**
 * Resolve the actor from the request.
 * 1. Bearer sk-agent-... → Agent API key → Actor(agent)
 * 2. NextAuth session → Actor(user)
 * 3. null if unauthenticated
 */
async function resolveActor(req) {
    // 1. Check for Agent API key
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer sk-agent-")) {
        const plainKey = authHeader.slice(7); // "Bearer " = 7 chars
        const resolved = await (0, agent_service_1.resolveAgentByApiKey)(plainKey);
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
    const session = await (0, next_auth_1.getServerSession)();
    if (session?.user?.id) {
        // Workspace from header or query — agents are workspace-scoped
        const workspaceId = req.headers.get("x-workspace-id") ??
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
function requireActor(actor) {
    if (!actor) {
        throw new Error("Unauthorized");
    }
}
/**
 * Guard: require a user (not an agent)
 */
function requireUser(actor) {
    if (!actor || actor.type !== "user") {
        throw new Error("User authentication required");
    }
}
