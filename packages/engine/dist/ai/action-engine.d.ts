import type { AIActionProposal, AIApplyResult, AIProposalState, AIRunRecord, AIRunResult } from './types';
import type { Priority } from '../types/types';
import { getProposalSafetyProfile } from './safety';
export interface AIProposalPreviewItem {
    key: string;
    title: string;
    description: string;
    reason: string;
    assignee?: string;
    dueDate?: string;
    priority?: Priority;
}
export declare function hasPendingProposal(result?: AIRunResult | null): boolean;
export declare function getProposalItemCount(proposal: AIActionProposal): number;
export declare function getProposalPeople(proposal: AIActionProposal): string[];
export declare function getProposalDates(proposal: AIActionProposal): string[];
export declare function getProposalPreviewItems(proposal: AIActionProposal): AIProposalPreviewItem[];
export { getProposalSafetyProfile };
export declare function buildApplyResult(proposal: AIActionProposal, appliedAt: string): AIApplyResult;
export declare function reduceProposalState(run: AIRunRecord, proposalId: string, nextState: AIProposalState, actionResult?: AIApplyResult | null): {
    status: "done" | "needs_approval";
    updatedAt: string;
    result: {
        actionResult: AIApplyResult | null;
        proposal: {
            state: AIProposalState;
            type: "create_tasks";
            tasks: import("./types").AITaskDraft[];
            id: string;
            title: string;
            summary: string;
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "update_tasks";
            taskUpdates: import("./types").AITaskUpdateDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "reschedule_tasks";
            taskReschedules: import("./types").AITaskRescheduleDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "raise_risks";
            risks: import("./types").AIRiskDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "draft_status_report";
            statusReport: import("./types").AIStatusReportDraft;
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "notify_team";
            notifications: import("./types").AINotificationDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        };
        title: string;
        summary: string;
        highlights: string[];
        nextSteps: string[];
        facts?: import("./types").AIEvidenceFact[];
        confidence?: import("./types").AIConfidenceSummary;
        collaboration?: import("./types").AIMultiAgentCollaboration | null;
    };
    id: string;
    sessionId?: string;
    agentId: string;
    title: string;
    prompt: string;
    quickActionId?: string;
    createdAt: string;
    context: import("./types").AIContextRef;
    errorMessage?: string;
};
export declare function applyAIProposal(run: AIRunRecord, proposalId: string): {
    status: "done" | "needs_approval";
    updatedAt: string;
    result: {
        actionResult: AIApplyResult | null;
        proposal: {
            state: AIProposalState;
            type: "create_tasks";
            tasks: import("./types").AITaskDraft[];
            id: string;
            title: string;
            summary: string;
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "update_tasks";
            taskUpdates: import("./types").AITaskUpdateDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "reschedule_tasks";
            taskReschedules: import("./types").AITaskRescheduleDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "raise_risks";
            risks: import("./types").AIRiskDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "draft_status_report";
            statusReport: import("./types").AIStatusReportDraft;
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        } | {
            state: AIProposalState;
            type: "notify_team";
            notifications: import("./types").AINotificationDraft[];
            id: string;
            title: string;
            summary: string;
            tasks: import("./types").AITaskDraft[];
            facts?: import("./types").AIEvidenceFact[];
            confidence?: import("./types").AIConfidenceSummary;
        };
        title: string;
        summary: string;
        highlights: string[];
        nextSteps: string[];
        facts?: import("./types").AIEvidenceFact[];
        confidence?: import("./types").AIConfidenceSummary;
        collaboration?: import("./types").AIMultiAgentCollaboration | null;
    };
    id: string;
    sessionId?: string;
    agentId: string;
    title: string;
    prompt: string;
    quickActionId?: string;
    createdAt: string;
    context: import("./types").AIContextRef;
    errorMessage?: string;
};
//# sourceMappingURL=action-engine.d.ts.map