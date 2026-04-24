import { type ServerAIRunEntry } from '../ai/server-runs';
import { type DerivedSyncStore } from '../sync-state';
import type { EscalationListResult, EscalationQuery, EscalationRecordView, EscalationSummary, EscalationUpdateInput } from "./types";
interface StoredEscalationItem {
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
    urgency: string;
    queueStatus: string;
    sourceStatus: string;
    ownerId: string | null;
    ownerName: string | null;
    ownerRole: string | null;
    firstObservedAt: Date;
    lastObservedAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    slaTargetAt: Date;
    metadataJson: string | null;
    createdAt: Date;
    updatedAt: Date;
}
interface EscalationWriteShape {
    sourceType: string;
    sourceRef: string | null;
    entityType: string;
    entityRef: string;
    projectId: string | null;
    projectName: string | null;
    title: string;
    summary: string | null;
    purpose: string | null;
    urgency: string;
    queueStatus: string;
    sourceStatus: string;
    ownerId: string | null;
    ownerName: string | null;
    ownerRole: string | null;
    firstObservedAt: Date;
    lastObservedAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    slaTargetAt: Date;
    metadataJson: string | null;
    updatedAt: Date;
}
interface EscalationStore {
    upsert(args: {
        where: {
            sourceType_entityType_entityRef: {
                sourceType: string;
                entityType: string;
                entityRef: string;
            };
        };
        create: {
            id: string;
        } & EscalationWriteShape;
        update: EscalationWriteShape;
    }): Promise<StoredEscalationItem>;
    findMany(args?: {
        take?: number;
        where?: {
            projectId?: string | null;
            queueStatus?: string;
            sourceType?: string;
            urgency?: string;
        };
    }): Promise<StoredEscalationItem[]>;
    findUnique(args: {
        where: {
            id: string;
        };
    }): Promise<StoredEscalationItem | null>;
    update(args: {
        where: {
            id: string;
        };
        data: Partial<EscalationWriteShape>;
    }): Promise<StoredEscalationItem>;
}
interface MemberLookupResult {
    id: string;
    name: string;
    role: string | null;
}
interface EscalationServiceDeps {
    escalationStore?: EscalationStore;
    listRunEntries?: () => Promise<ServerAIRunEntry[]>;
    lookupMember?: (memberId: string) => Promise<MemberLookupResult | null>;
    now?: () => Date;
    syncStore?: DerivedSyncStore;
}
export declare const ESCALATION_QUEUE_SYNC_KEY = "escalation_queue";
export declare function getEscalationQueueOverview(query?: EscalationQuery, deps?: EscalationServiceDeps): Promise<EscalationListResult>;
export declare function getEscalationItemById(id: string, deps?: Pick<EscalationServiceDeps, "escalationStore" | "now">): Promise<EscalationRecordView | null>;
export declare function updateEscalationItem(id: string, input: EscalationUpdateInput, deps?: EscalationServiceDeps): Promise<EscalationRecordView | null>;
export declare function syncEscalationQueue(deps?: EscalationServiceDeps): Promise<void>;
export declare function summarizeEscalations(items: EscalationRecordView[]): EscalationSummary;
export {};
//# sourceMappingURL=service.d.ts.map