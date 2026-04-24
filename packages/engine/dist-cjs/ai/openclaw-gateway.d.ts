import type { AIRunInput, AIRunResult } from './types';
export declare function buildGatewayPrompt(input: AIRunInput, runId: string): string;
export declare function parseGatewayResult(rawText: string, runId: string): AIRunResult;
export declare function invokeOpenClawGateway(input: AIRunInput, runId: string, options?: {
    promptOverride?: string;
}): Promise<AIRunResult>;
//# sourceMappingURL=openclaw-gateway.d.ts.map