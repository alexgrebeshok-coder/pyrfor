import type { Actor } from "./types";
import type { NextRequest } from "next/server";
/**
 * Resolve the actor from the request.
 * 1. Bearer sk-agent-... → Agent API key → Actor(agent)
 * 2. NextAuth session → Actor(user)
 * 3. null if unauthenticated
 */
export declare function resolveActor(req: NextRequest): Promise<Actor | null>;
/**
 * Guard: require any authenticated actor
 */
export declare function requireActor(actor: Actor | null): asserts actor is Actor;
/**
 * Guard: require a user (not an agent)
 */
export declare function requireUser(actor: Actor | null): asserts actor is Actor & {
    type: "user";
};
//# sourceMappingURL=actor.d.ts.map