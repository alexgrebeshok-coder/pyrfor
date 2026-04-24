type OneCFetch = typeof fetch;
type OneCProbeMetadata = Record<string, string | number | boolean | null>;
type OneCSampleMetadata = Record<string, string | number | boolean | null>;
export interface OneCProjectFinanceSample {
    source: "one-c";
    projectId: string | null;
    projectName: string | null;
    status: string;
    currency: string | null;
    reportDate: string | null;
    plannedBudget: number | null;
    actualBudget: number | null;
    paymentsActual: number | null;
    actsActual: number | null;
    variance: number | null;
    variancePercent: number | null;
}
export interface OneCFinanceSampleSnapshot {
    id: "one-c";
    checkedAt: string;
    configured: boolean;
    status: "ok" | "pending" | "degraded";
    message: string;
    missingSecrets: string[];
    sampleUrl?: string;
    samples: OneCProjectFinanceSample[];
    metadata?: OneCSampleMetadata;
}
export interface OneCProjectFinanceTruth extends OneCProjectFinanceSample {
    projectKey: string;
    observedAt: string | null;
    actualToPlanRatio: number | null;
    paymentsToActualRatio: number | null;
    actsToActualRatio: number | null;
    paymentGap: number | null;
    actGap: number | null;
    paymentsVsActsGap: number | null;
    budgetDeltaStatus: "on_plan" | "over_plan" | "under_plan" | "unknown";
}
export interface OneCFinanceTruthSummary {
    projectCount: number;
    overPlanCount: number;
    underPlanCount: number;
    onPlanCount: number;
    totalPlannedBudget: number;
    totalActualBudget: number;
    totalPaymentsActual: number;
    totalActsActual: number;
    totalBudgetVariance: number;
    totalPaymentGap: number;
    totalActGap: number;
}
export interface OneCFinanceTruthSnapshot extends OneCFinanceSampleSnapshot {
    summary: OneCFinanceTruthSummary;
    projects: OneCProjectFinanceTruth[];
}
export declare function getOneCApiUrl(env?: NodeJS.ProcessEnv): string | null;
export declare function getOneCApiKey(env?: NodeJS.ProcessEnv): string | null;
export declare function buildOneCSampleUrl(baseUrl: string, pageSize?: number): string;
export declare function buildOneCProbeUrl(baseUrl: string): string;
export declare function probeOneCApi(input: {
    baseUrl: string;
    apiKey: string;
}, fetchImpl?: OneCFetch): Promise<{
    ok: true;
    probeUrl: string;
    remoteStatus: "ok" | "degraded";
    message: string;
    metadata: OneCProbeMetadata;
} | {
    ok: false;
    probeUrl: string;
    message: string;
    status?: number;
    metadata?: OneCProbeMetadata;
}>;
export declare function fetchOneCFinanceSample(input: {
    baseUrl: string;
    apiKey: string;
    pageSize?: number;
}, fetchImpl?: OneCFetch): Promise<{
    ok: true;
    sampleUrl: string;
    message: string;
    samples: OneCProjectFinanceSample[];
    metadata: OneCSampleMetadata;
} | {
    ok: false;
    sampleUrl: string;
    message: string;
    status?: number;
    metadata?: OneCSampleMetadata;
}>;
export declare function getOneCFinanceSampleSnapshot(env?: NodeJS.ProcessEnv, fetchImpl?: OneCFetch): Promise<OneCFinanceSampleSnapshot>;
export declare function getOneCFinanceTruthSnapshot(options?: {
    pageSize?: number;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: OneCFetch;
}): Promise<OneCFinanceTruthSnapshot>;
export declare function buildOneCFinanceTruthSnapshot(snapshot: OneCFinanceSampleSnapshot): OneCFinanceTruthSnapshot;
export {};
//# sourceMappingURL=one-c-client.d.ts.map