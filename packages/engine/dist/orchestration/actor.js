// Unified Actor context — resolves User (NextAuth) or Agent (API key)
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getServerSession } from "next-auth";
import { resolveAgentByApiKey } from "./agent-service.js";
/**
 * Resolve the actor from the request.
 * 1. Bearer sk-agent-... → Agent API key → Actor(agent)
 * 2. NextAuth session → Actor(user)
 * 3. null if unauthenticated
 */
export function resolveActor(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        // 1. Check for Agent API key
        const authHeader = req.headers.get("authorization");
        if (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer sk-agent-")) {
            const plainKey = authHeader.slice(7); // "Bearer " = 7 chars
            const resolved = yield resolveAgentByApiKey(plainKey);
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
        const session = yield getServerSession();
        if ((_a = session === null || session === void 0 ? void 0 : session.user) === null || _a === void 0 ? void 0 : _a.id) {
            // Workspace from header or query — agents are workspace-scoped
            const workspaceId = (_c = (_b = req.headers.get("x-workspace-id")) !== null && _b !== void 0 ? _b : req.nextUrl.searchParams.get("workspaceId")) !== null && _c !== void 0 ? _c : "executive";
            return {
                type: "user",
                id: session.user.id,
                workspaceId,
            };
        }
        return null;
    });
}
/**
 * Guard: require any authenticated actor
 */
export function requireActor(actor) {
    if (!actor) {
        throw new Error("Unauthorized");
    }
}
/**
 * Guard: require a user (not an agent)
 */
export function requireUser(actor) {
    if (!actor || actor.type !== "user") {
        throw new Error("User authentication required");
    }
}
