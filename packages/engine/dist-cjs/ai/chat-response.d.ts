import type { AIConfidenceSummary, AIEvidenceFact } from './types';
export interface AIChatResponsePayload {
    success?: boolean;
    response?: string;
    error?: string;
    provider?: string;
    model?: string;
    runId?: string;
    status?: string;
    facts?: unknown;
    confidence?: unknown;
    context?: Record<string, unknown>;
}
export declare function normalizeChatFacts(value: unknown): AIEvidenceFact[];
export declare function normalizeChatConfidence(value: unknown): AIConfidenceSummary | undefined;
//# sourceMappingURL=chat-response.d.ts.map