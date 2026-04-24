type OneCFetch = typeof fetch;
export interface OneCODataCounterparty {
    id: string | null;
    code: string | null;
    description: string | null;
    inn: string | null;
}
export interface OneCODataReceiptDocument {
    id: string | null;
    number: string | null;
    date: string | null;
    posted: boolean | null;
    operationType: string | null;
    counterparty: string | null;
    amount: number | null;
    currency: string | null;
}
export interface OneCODataSnapshot {
    id: "one-c-odata";
    checkedAt: string;
    configured: boolean;
    status: "ok" | "pending" | "degraded";
    message: string;
    missingSecrets: string[];
    metadata?: Record<string, string | number | boolean | null>;
    sampleUrl?: string;
    counterparties: OneCODataCounterparty[];
    receipts: OneCODataReceiptDocument[];
}
export declare function getOneCODataUrl(env?: NodeJS.ProcessEnv): string | null;
export declare function getOneCODataAuth(env?: NodeJS.ProcessEnv): {
    token: string | null;
    username: string | null;
    password: string | null;
    configured: boolean;
};
export declare function buildOneCODataEntityUrl(baseUrl: string, entityPath: string, query?: Record<string, string | number | undefined | null>): string;
export declare function fetchOneCODataCollection<T>(input: {
    baseUrl: string;
    entityPath: string;
    query?: Record<string, string | number | undefined | null>;
    env?: NodeJS.ProcessEnv;
}, fetchImpl?: OneCFetch): Promise<{
    url: string;
    items: T[];
}>;
export declare function getOneCODataSnapshot(env?: NodeJS.ProcessEnv, fetchImpl?: OneCFetch): Promise<OneCODataSnapshot>;
export {};
//# sourceMappingURL=one-c-odata.d.ts.map