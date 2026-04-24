import type { ExecutiveSnapshot } from "./types";
type SnapshotFilter = {
    projectId?: string;
    generatedAt?: string | Date;
};
export declare function loadExecutiveSnapshot(filter?: SnapshotFilter): Promise<ExecutiveSnapshot>;
export declare function buildMockExecutiveSnapshot(filter?: SnapshotFilter): Promise<ExecutiveSnapshot>;
export {};
//# sourceMappingURL=snapshot.d.ts.map