import type { DerivedSyncCheckpointView } from '../sync-state';
export type EscalationQueueStatus = "open" | "acknowledged" | "resolved";
export type EscalationUrgency = "critical" | "high" | "medium" | "low";
export type EscalationSourceStatus = "queued" | "running" | "needs_approval" | "failed" | "resolved";
export type EscalationSlaState = "on_track" | "due_soon" | "breached" | "resolved";
export interface EscalationOwnerView {
    id: string;
    name: string;
    role: string | null;
}
export interface EscalationMetadata {
    agentId?: string;
    packetId?: string;
    packetLabel?: string;
    proposalId?: string;
    proposalItemCount?: number;
    proposalType?: string;
    purposeLabel?: string;
    tracePath?: string;
    runId?: string;
}
export interface EscalationRecordView {
    id: string;
    sourceType: string;
    sourceRef: string | null;
    entityType: string;
    entityRef: string;
    projectId: string | null;
    projectName: string | null;
    title: string;
    summary: string | null;
    purpose: string | null;
    urgency: EscalationUrgency;
    queueStatus: EscalationQueueStatus;
    sourceStatus: EscalationSourceStatus;
    owner: EscalationOwnerView | null;
    recommendedOwnerRole: string | null;
    firstObservedAt: string;
    lastObservedAt: string;
    acknowledgedAt: string | null;
    resolvedAt: string | null;
    slaTargetAt: string;
    slaState: EscalationSlaState;
    ageHours: number;
    metadata: EscalationMetadata;
}
export interface EscalationSummary {
    total: number;
    open: number;
    acknowledged: number;
    resolved: number;
    critical: number;
    high: number;
    dueSoon: number;
    breached: number;
    unassigned: number;
}
export interface EscalationQuery {
    includeResolved?: boolean;
    limit?: number;
    projectId?: string;
    queueStatus?: EscalationQueueStatus;
    urgency?: EscalationUrgency;
}
export interface EscalationListResult {
    syncedAt: string | null;
    summary: EscalationSummary;
    items: EscalationRecordView[];
    sync: DerivedSyncCheckpointView | null;
}
export interface EscalationUpdateInput {
    ownerId?: string | null;
    queueStatus?: EscalationQueueStatus;
}
//# sourceMappingURL=types.d.ts.map