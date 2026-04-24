import type { ExecutiveSnapshot } from "./types";
export declare function loadExecutiveSnapshotSafe(filter?: {
    projectId?: string;
    generatedAt?: string | Date;
}): Promise<{
    snapshot: ExecutiveSnapshot;
    usingFallback: boolean;
    error?: string;
}>;
//# sourceMappingURL=snapshot-safe.d.ts.map