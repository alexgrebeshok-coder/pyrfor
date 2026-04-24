import type { AIChatContextBundle } from './context-builder';
import type { AIConfidenceSummary, AIEvidenceFact, AIRunInput, AIRunResult } from './types';
interface GroundingResult {
    facts: AIEvidenceFact[];
    confidence: AIConfidenceSummary;
}
export declare function buildChatGrounding(bundle: AIChatContextBundle): GroundingResult;
export declare function attachRunGrounding(result: AIRunResult, input: AIRunInput): AIRunResult;
export {};
//# sourceMappingURL=grounding.d.ts.map