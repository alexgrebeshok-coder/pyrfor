import type { GpsTelemetrySampleSnapshot } from '../connectors/gps-client';
import { type DerivedSyncStore } from '../sync-state';
import type { WorkReportView } from '../work-reports/types';
import type { EvidenceListResult, EvidenceQuery, EvidenceRecordView, EvidenceSummary, EvidenceUpsertInput } from "./types";
interface StoredEvidenceRecord {
    id: string;
    sourceType: string;
    sourceRef: string | null;
    entityType: string;
    entityRef: string;
    projectId: string | null;
    title: string;
    summary: string | null;
    observedAt: Date;
    reportedAt: Date | null;
    confidence: number;
    verificationStatus: string;
    metadataJson: string | null;
    createdAt: Date;
    updatedAt: Date;
}
interface EvidenceStore {
    upsert(args: {
        where: {
            sourceType_entityType_entityRef: {
                entityRef: string;
                entityType: string;
                sourceType: string;
            };
        };
        create: {
            id: string;
        } & EvidenceWriteShape;
        update: EvidenceWriteShape;
    }): Promise<StoredEvidenceRecord>;
    findMany(args: {
        orderBy: {
            observedAt: "desc";
        };
        take: number;
        where?: {
            entityRef?: string;
            entityType?: string;
            projectId?: string;
            verificationStatus?: string;
        };
    }): Promise<StoredEvidenceRecord[]>;
    findUnique(args: {
        where: {
            id: string;
        };
    }): Promise<StoredEvidenceRecord | null>;
    deleteMany(args: {
        where: {
            entityRef?: string;
            entityType?: string;
            sourceType?: string;
        };
    }): Promise<{
        count: number;
    }>;
}
interface EvidenceServiceDeps {
    evidenceStore?: EvidenceStore;
    gpsSnapshot?: GpsTelemetrySampleSnapshot;
    listReports?: (input?: {
        limit?: number;
    }) => Promise<WorkReportView[]>;
    now?: () => Date;
    syncStore?: DerivedSyncStore;
}
interface SyncEvidenceOptions {
    includeGpsSample?: boolean;
    includeWorkReports?: boolean;
}
type EvidenceWriteShape = {
    confidence: number;
    entityRef: string;
    entityType: string;
    metadataJson: string | null;
    observedAt: Date;
    projectId: string | null;
    reportedAt: Date | null;
    sourceRef: string | null;
    sourceType: string;
    summary: string | null;
    title: string;
    verificationStatus: string;
    updatedAt: Date;
};
export declare const EVIDENCE_LEDGER_SYNC_KEY = "evidence_ledger";
export declare function getEvidenceLedgerOverview(query?: EvidenceQuery, deps?: EvidenceServiceDeps): Promise<EvidenceListResult>;
export declare function syncEvidenceLedger(deps?: EvidenceServiceDeps, options?: SyncEvidenceOptions): Promise<void>;
export declare function syncWorkReportEvidenceRecord(report: WorkReportView, deps?: Pick<EvidenceServiceDeps, "evidenceStore" | "now" | "syncStore">): Promise<void>;
export declare function removeEvidenceRecordForEntity(entityType: string, entityRef: string, deps?: Pick<EvidenceServiceDeps, "evidenceStore" | "now" | "syncStore">): Promise<number>;
export declare function getEvidenceRecordById(id: string, deps?: Pick<EvidenceServiceDeps, "evidenceStore">): Promise<EvidenceRecordView | null>;
export declare function mapWorkReportToEvidenceInput(report: WorkReportView): EvidenceUpsertInput | null;
export declare function mapGpsSnapshotToEvidenceInputs(snapshot: GpsTelemetrySampleSnapshot): EvidenceUpsertInput[];
export declare function summarizeEvidenceRecords(records: EvidenceRecordView[]): EvidenceSummary;
export {};
//# sourceMappingURL=service.d.ts.map