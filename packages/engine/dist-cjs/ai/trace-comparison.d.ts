import type { AIRunTrace } from './trace';
export interface AIRunTraceComparison {
    originalRunId: string;
    replayRunId: string;
    sameWorkflow: boolean;
    samePrompt: boolean;
    sameContext: boolean;
    sameModel: boolean;
    sameStatus: boolean;
    sameProposalType: boolean;
    sameProposalState: boolean;
    sameCollaboration: boolean;
    originalModelName: string;
    replayModelName: string;
    originalStatus: AIRunTrace["status"];
    replayStatus: AIRunTrace["status"];
    originalProposalType: string | null;
    replayProposalType: string | null;
    originalProposalState: string | null;
    replayProposalState: string | null;
    originalProposalItemCount: number;
    replayProposalItemCount: number;
    originalCouncilSize: number;
    replayCouncilSize: number;
    itemCountDelta: number;
    changedFields: string[];
    summary: string;
}
export declare function buildAIRunTraceComparison(original: AIRunTrace, replay: AIRunTrace): AIRunTraceComparison;
//# sourceMappingURL=trace-comparison.d.ts.map