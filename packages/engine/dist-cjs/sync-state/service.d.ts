import type { DerivedSyncCheckpointView, DerivedSyncMetadata } from "./types";
interface StoredDerivedSyncState {
    key: string;
    status: string;
    lastStartedAt: Date | null;
    lastCompletedAt: Date | null;
    lastSuccessAt: Date | null;
    lastError: string | null;
    lastResultCount: number | null;
    metadataJson: string | null;
    createdAt: Date;
    updatedAt: Date;
}
type DerivedSyncWriteShape = {
    status: string;
    lastStartedAt: Date | null;
    lastCompletedAt: Date | null;
    lastSuccessAt: Date | null;
    lastError: string | null;
    lastResultCount: number | null;
    metadataJson: string | null;
    updatedAt: Date;
};
export interface DerivedSyncStore {
    findUnique(args: {
        where: {
            key: string;
        };
    }): Promise<StoredDerivedSyncState | null>;
    upsert(args: {
        where: {
            key: string;
        };
        create: {
            key: string;
        } & DerivedSyncWriteShape;
        update: DerivedSyncWriteShape;
    }): Promise<StoredDerivedSyncState>;
}
interface DerivedSyncDeps {
    now?: () => Date;
    syncStore?: DerivedSyncStore;
}
export declare function getDerivedSyncCheckpoint(key: string, deps?: Pick<DerivedSyncDeps, "syncStore">): Promise<DerivedSyncCheckpointView | null>;
export declare function markDerivedSyncStarted(key: string, deps?: DerivedSyncDeps): Promise<DerivedSyncCheckpointView>;
export declare function markDerivedSyncSuccess(key: string, input: {
    metadata?: DerivedSyncMetadata;
    resultCount?: number | null;
}, deps?: DerivedSyncDeps): Promise<DerivedSyncCheckpointView>;
export declare function markDerivedSyncError(key: string, error: unknown, input?: {
    metadata?: DerivedSyncMetadata;
}, deps?: DerivedSyncDeps): Promise<DerivedSyncCheckpointView>;
export {};
//# sourceMappingURL=service.d.ts.map