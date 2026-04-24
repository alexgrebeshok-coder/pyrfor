/**
 * Russian AI Provider Adapter
 *
 * Supports: AIJora, Polza.ai, OpenRouter, Bothub, OpenAI
 * OpenAI-compatible API with fallback chain
 */
import type { AIAdapter, AIApplyProposalInput, AIRunInput, AIRunRecord } from './types';
type ProviderName = string;
export declare function hasAvailableProviders(): boolean;
export declare class ProviderAdapter implements AIAdapter {
    mode: "provider";
    private priority;
    private timeout;
    private mockAdapter;
    private runStore;
    constructor(options?: {
        priority?: ProviderName[];
        timeout?: number;
    });
    private getDefaultPriority;
    private getProvider;
    private isProviderAvailable;
    private createRunId;
    runAgent(input: AIRunInput & {
        signal?: AbortSignal;
    }): Promise<AIRunRecord>;
    private executeWithProviders;
    private tryProvider;
    private buildSystemPrompt;
    private buildUserPrompt;
    private buildFinalRun;
    private buildFailedRun;
    getRun(runId: string): Promise<AIRunRecord>;
    applyProposal(input: AIApplyProposalInput): Promise<AIRunRecord>;
}
export declare function createProviderAdapter(options?: {
    priority?: ProviderName[];
    timeout?: number;
}): ProviderAdapter;
export {};
//# sourceMappingURL=provider-adapter.d.ts.map