import "server-only";
import type { AIApplyProposalInput, AIRunInput, AIRunRecord } from './types';
export type ServerAIRunOrigin = "gateway" | "provider" | "mock";
export type ServerAIExecutionMode = ServerAIRunOrigin | "unavailable";
export type ServerAIStatus = {
    mode: ServerAIExecutionMode;
    gatewayKind: "local" | "remote" | "missing";
    gatewayAvailable: boolean;
    providerAvailable: boolean;
    isProduction: boolean;
    unavailableReason: string | null;
};
export type ServerAIRunEntry = {
    origin: ServerAIRunOrigin;
    input: AIRunInput;
    run: AIRunRecord;
};
export declare class AIUnavailableError extends Error {
    constructor(message: string);
}
export declare function isAIUnavailableError(error: unknown): error is AIUnavailableError;
export declare function hasOpenClawGateway(): boolean;
export declare function getServerAIStatus(): ServerAIStatus;
export declare function buildReplayAIRunInput(entry: ServerAIRunEntry): AIRunInput;
export declare function createServerAIRun(rawInput: AIRunInput): Promise<AIRunRecord>;
export declare function getServerAIRun(runId: string): Promise<AIRunRecord>;
export declare function getServerAIRunEntry(runId: string): Promise<ServerAIRunEntry>;
export declare function listServerAIRunEntries(): Promise<ServerAIRunEntry[]>;
export declare function applyServerAIProposal(input: AIApplyProposalInput): Promise<AIRunRecord>;
export declare function replayServerAIRun(runId: string): Promise<AIRunRecord>;
//# sourceMappingURL=server-runs.d.ts.map