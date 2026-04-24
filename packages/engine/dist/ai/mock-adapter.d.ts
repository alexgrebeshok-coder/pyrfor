import type { AIAdapter, AIRunInput, AIRunRecord } from './types';
export declare function buildMockFinalRun(input: AIRunInput, seed?: Partial<Pick<AIRunRecord, "id" | "createdAt" | "updatedAt" | "quickActionId">>): AIRunRecord;
export declare function applyMockProposal(run: AIRunRecord, proposalId: string): AIRunRecord;
export declare function createMockAIAdapter(): AIAdapter;
//# sourceMappingURL=mock-adapter.d.ts.map