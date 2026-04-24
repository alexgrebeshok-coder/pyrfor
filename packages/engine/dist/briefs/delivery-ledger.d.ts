export type BriefDeliveryChannel = "telegram" | "email";
export type BriefDeliveryMode = "manual" | "scheduled";
export type BriefDeliveryScope = "governance" | "portfolio" | "project" | "work_report";
export type BriefDeliveryLedgerStatus = "pending" | "preview" | "delivered" | "failed";
export type BriefDeliveryRetryPosture = "preview_only" | "sealed" | "retryable";
export interface BriefDeliveryLedgerRecord {
    id: string;
    channel: BriefDeliveryChannel;
    provider: string;
    mode: BriefDeliveryMode;
    scope: BriefDeliveryScope;
    projectId: string | null;
    projectName: string | null;
    locale: string;
    target: string | null;
    headline: string;
    idempotencyKey: string;
    scheduledPolicyId: string | null;
    status: BriefDeliveryLedgerStatus;
    retryPosture: BriefDeliveryRetryPosture;
    attemptCount: number;
    dryRun: boolean;
    providerMessageId: string | null;
    contentHash: string;
    lastError: string | null;
    firstAttemptAt: string | null;
    lastAttemptAt: string | null;
    deliveredAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface BriefDeliveryExecutionInput {
    channel: BriefDeliveryChannel;
    provider: string;
    mode: BriefDeliveryMode;
    scope: BriefDeliveryScope;
    projectId?: string | null;
    projectName?: string | null;
    locale: string;
    target?: string | null;
    headline: string;
    content: Record<string, string | null | undefined>;
    requestPayload: Record<string, unknown>;
    dryRun?: boolean;
    idempotencyKey?: string | null;
    scheduledPolicyId?: string | null;
    env?: NodeJS.ProcessEnv;
    execute?: () => Promise<{
        providerMessageId?: string | number | null;
        providerPayload?: unknown;
    }>;
}
export interface BriefDeliveryExecutionOutcome {
    ledger: BriefDeliveryLedgerRecord | null;
    replayed: boolean;
    providerMessageId: string | null;
}
export interface BriefDeliveryLedgerQuery {
    limit?: number;
    scheduledPolicyId?: string;
    scope?: BriefDeliveryScope;
    channel?: BriefDeliveryChannel;
    projectId?: string;
}
export declare function buildScheduledBriefDeliveryIdempotencyKey(input: {
    channel: BriefDeliveryChannel;
    policyId: string;
    windowKey: string;
}): string;
export declare function executeBriefDelivery(input: BriefDeliveryExecutionInput): Promise<{
    ledger: null;
    replayed: false;
    providerMessageId: string | null;
} | {
    ledger: BriefDeliveryLedgerRecord;
    replayed: true;
    providerMessageId: string | null;
} | {
    ledger: BriefDeliveryLedgerRecord;
    replayed: false;
    providerMessageId: string | null;
}>;
export declare function listBriefDeliveryLedger(query?: BriefDeliveryLedgerQuery): Promise<BriefDeliveryLedgerRecord[]>;
export declare function listRecentBriefDeliveryLedger(limit?: number): Promise<BriefDeliveryLedgerRecord[]>;
//# sourceMappingURL=delivery-ledger.d.ts.map