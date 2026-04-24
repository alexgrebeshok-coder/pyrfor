import { type OneCFinanceTruthSnapshot, type OneCProjectFinanceTruth } from "./one-c-client";
export interface OneCExpenseSyncItem {
    oneCRef: string;
    sourceProjectKey: string;
    sourceProjectId: string | null;
    sourceProjectName: string | null;
    matchedProjectId: string | null;
    matchedProjectName: string | null;
    categoryCode: string;
    title: string;
    description: string;
    amount: number;
    currency: string;
    date: string;
    status: "approved";
    variance: number | null;
    paymentGap: number | null;
    actGap: number | null;
    budgetDeltaStatus: OneCProjectFinanceTruth["budgetDeltaStatus"];
    action: "upsert" | "skip";
    reason?: string;
}
export interface OneCExpenseSyncPreview {
    sourceStatus: OneCFinanceTruthSnapshot["status"];
    configured: boolean;
    checkedAt: string;
    missingSecrets: string[];
    summary: {
        sourceProjectCount: number;
        matchedProjectCount: number;
        readyToSyncCount: number;
        skippedCount: number;
    };
    items: OneCExpenseSyncItem[];
}
export interface OneCExpenseSyncResult extends OneCExpenseSyncPreview {
    created: number;
    updated: number;
    skipped: number;
}
export declare function getOneCExpenseSyncPreview(): Promise<OneCExpenseSyncPreview>;
export declare function syncOneCExpenses(): Promise<OneCExpenseSyncResult>;
export declare function mapRecordToExpenseItem(record: OneCProjectFinanceTruth, projects: Array<{
    id: string;
    name: string;
}>): OneCExpenseSyncItem;
//# sourceMappingURL=one-c-expense-sync.d.ts.map