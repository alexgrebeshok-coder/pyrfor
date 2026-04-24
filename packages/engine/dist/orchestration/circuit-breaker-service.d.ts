import type { AgentRuntimeConfig, CircuitState } from "./types";
export declare class AgentCircuitOpenError extends Error {
    readonly openUntil?: (Date | null) | undefined;
    constructor(message: string, openUntil?: (Date | null) | undefined);
}
export interface AgentCircuitSnapshot {
    state: CircuitState;
    consecutiveFailures: number;
    openedAt: Date | null;
    openUntil: Date | null;
}
type RuntimeStateRecord = {
    consecutiveFailures: number;
    circuitState: string;
    circuitOpenedAt: Date | null;
    circuitOpenUntil: Date | null;
};
type CircuitPrisma = {
    agentRuntimeState: {
        findUnique(args: {
            where: {
                agentId: string;
            };
            select: {
                consecutiveFailures: true;
                circuitState: true;
                circuitOpenedAt: true;
                circuitOpenUntil: true;
            };
        }): Promise<RuntimeStateRecord | null>;
        upsert(args: {
            where: {
                agentId: string;
            };
            create: {
                agentId: string;
                consecutiveFailures: number;
                circuitState: string;
                circuitOpenedAt?: Date | null;
                circuitOpenUntil?: Date | null;
            };
            update: {
                consecutiveFailures?: number;
                circuitState?: string;
                circuitOpenedAt?: Date | null;
                circuitOpenUntil?: Date | null;
            };
        }): Promise<unknown>;
    };
};
export declare function isAgentCircuitOpen(snapshot: AgentCircuitSnapshot, now?: Date): boolean;
export declare function getAgentCircuitSnapshot(agentId: string, prismaClient?: CircuitPrisma): Promise<AgentCircuitSnapshot>;
export declare function ensureAgentCircuitReady(agentId: string, runtimeConfig?: AgentRuntimeConfig | string | null, prismaClient?: CircuitPrisma): Promise<AgentCircuitSnapshot>;
export declare function recordAgentCircuitSuccess(agentId: string, prismaClient?: CircuitPrisma): Promise<void>;
export declare function recordAgentCircuitFailure(agentId: string, runtimeConfig?: AgentRuntimeConfig | string | null, prismaClient?: CircuitPrisma): Promise<AgentCircuitSnapshot>;
export {};
//# sourceMappingURL=circuit-breaker-service.d.ts.map