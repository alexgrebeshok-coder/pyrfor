import { type ServerAIRunEntry, type ServerAIRunOrigin } from './server-runs';
import type { AIApplySafetySummary, AIMultiAgentCollaboration, AIProposalSafetyProfile, AIRunStatus, AIRunSourceRef } from './types';
export type AIRunTraceStepStatus = "pending" | "running" | "done" | "failed" | "not_applicable";
export interface AIRunTraceSourceSummary extends AIRunSourceRef {
    workflowLabel: string;
    purposeLabel: string | null;
    replayLabel: string | null;
}
export interface AIRunTraceFactSummary {
    projects: number;
    tasks: number;
    risks: number;
    team: number;
    notifications: number;
}
export interface AIRunTraceStep {
    id: string;
    label: string;
    status: AIRunTraceStepStatus;
    summary: string;
    startedAt?: string;
    endedAt?: string;
}
export interface AIRunTraceProposalSummary {
    type: string | null;
    state: string | null;
    title: string | null;
    summary: string | null;
    itemCount: number;
    previewItems: string[];
    safety: AIProposalSafetyProfile | null;
}
export interface AIRunTraceApplySummary {
    appliedAt: string;
    itemCount: number;
    summary: string;
    safety: AIApplySafetySummary;
}
export interface AIRunTrace {
    runId: string;
    workflow: string;
    title: string;
    status: AIRunStatus;
    agentId: string;
    quickActionId: string | null;
    origin: ServerAIRunOrigin;
    model: {
        name: string;
        status: AIRunTraceStepStatus;
    };
    source: AIRunTraceSourceSummary;
    context: {
        type: string;
        title: string;
        pathname: string;
        projectId?: string;
        facts: AIRunTraceFactSummary;
    };
    proposal: AIRunTraceProposalSummary;
    apply: AIRunTraceApplySummary | null;
    collaboration: AIMultiAgentCollaboration | null;
    promptPreview: string;
    createdAt: string;
    updatedAt: string;
    steps: AIRunTraceStep[];
    failure: {
        message: string;
    } | null;
}
export declare function buildAIRunTrace(entry: ServerAIRunEntry): AIRunTrace;
export declare function getServerAIRunTrace(runId: string): Promise<AIRunTrace>;
//# sourceMappingURL=trace.d.ts.map