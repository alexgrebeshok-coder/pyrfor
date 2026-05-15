export interface ProtoLineage {
    artifact_id: string;
    artifact_type: 'finding' | 'report' | 'extracted_table';
    source_files: string[];
    model_id: string;
    pyrfor_version: string;
    created_at: string;
}
export interface ReconciliationEvidenceRef {
    source_file_sha256: string;
    source_file_name: string;
    location: {
        page?: number;
        row?: number | string;
        cell?: string;
        odata_entity?: string;
    };
    extracted_text?: string;
}
export interface KsReconciliationFinding {
    finding_id: string;
    finding_type: 'amount_mismatch' | 'volume_mismatch' | 'name_mismatch' | 'date_mismatch' | 'missing_item';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
    delta?: {
        value: number;
        currency?: string;
        unit?: string;
    };
    evidence_ref: ReconciliationEvidenceRef[];
    status: KsReconciliationFindingStatus;
    reviewer_id: string | null;
    reviewed_at: string | null;
    reviewer_action: KsReconciliationFindingReviewAction | null;
    reviewer_comment: string | null;
    lineage_ref: string;
    ground_truth_id: 'D-01' | 'D-02' | 'D-03' | 'D-04' | 'D-05';
}
export type KsReconciliationFindingStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'DEFERRED' | 'ESCALATED';
export type KsReconciliationFindingReviewAction = 'accept' | 'reject' | 'defer' | 'escalate';
export interface KsReconciliationFindingReviewRecord {
    finding_id: string;
    action: KsReconciliationFindingReviewAction;
    reviewer_id: string;
    reviewed_at: string;
    reviewer_comment: string | null;
}
interface Ks2Row {
    position: number;
    name: string;
    unit: string;
    volume: number;
    amountRub: number;
    page: number;
    row: number;
}
interface ContractRow {
    position: number;
    name: string;
    unit: string;
    volume?: number;
    amountRub: number;
    sheet: string;
    row: number;
}
interface OdataEntry {
    id: string;
    date: string;
    nomenclature: string;
    unit: string;
    volume?: number;
    amountRub: number;
    odataEntity: string;
}
interface FixtureDocument<T> {
    fileName: string;
    kind: 'ks2' | 'ks3' | 'contract' | 'odata_v4' | 'odata_v3';
    sha256: string;
    content: T;
}
export interface KsReconciliationFixturePackage {
    schemaVersion: 'pyrfor.ks_reconciliation_fixture.v1';
    fixtureId: 'object-a-june-2025';
    scenario: {
        project: 'Object A';
        period: '2025-06';
        currency: 'RUB';
    };
    documents: {
        ks2: FixtureDocument<{
            documentId: string;
            rows: Ks2Row[];
            totalRub: number;
        }>;
        ks3: FixtureDocument<{
            documentId: string;
            summaryRows: Array<{
                label: string;
                amountRub: number;
                page: number;
                row: number;
            }>;
            totalRub: number;
            signedAt: string;
        }>;
        contract: FixtureDocument<{
            documentId: string;
            rows: ContractRow[];
        }>;
        odataV4: FixtureDocument<{
            documentId: string;
            value: OdataEntry[];
        }>;
        odataV3: FixtureDocument<{
            documentId: string;
            d: {
                results: OdataEntry[];
            };
        }>;
    };
    expectedFindings: Array<{
        id: KsReconciliationFinding['ground_truth_id'];
        finding_type: KsReconciliationFinding['finding_type'];
    }>;
}
export interface KsReconciliationReviewPack {
    schemaVersion: 'pyrfor.ks_reconciliation_review_pack.v1';
    runId: string;
    fixtureId: string;
    generatedAt: string;
    reviewStatus: 'PENDING_HUMAN_REVIEW' | 'FINDINGS_REVIEWED';
    reviewMode: 'pack_approval';
    scenario: KsReconciliationFixturePackage['scenario'];
    sourceDocuments: Array<{
        fileName: string;
        kind: FixtureDocument<unknown>['kind'];
        sha256: string;
    }>;
    findings: KsReconciliationFinding[];
    reviewHistory: KsReconciliationFindingReviewRecord[];
    lineage: ProtoLineage[];
    approvalRequest: {
        toolName: 'ks_reconciliation_review_approval';
        summary: string;
    };
    metrics: {
        producedFindings: number;
        expectedFindings: number;
        precision: number;
        recall: number;
        falsePositives: number;
        evidenceCoverage: number;
    };
}
export interface KsReconciliationFinalReport {
    schemaVersion: 'pyrfor.ks_reconciliation_report.v1';
    runId: string;
    fixtureId: string;
    generatedAt: string;
    scenario: KsReconciliationFixturePackage['scenario'];
    approval: {
        approvalId: string;
        decision: 'approve';
        reviewMode: 'pack_approval';
    };
    summary: {
        findingsAccepted: number;
        findingsReviewed: number;
        reviewCounts: Record<Exclude<KsReconciliationFindingStatus, 'PENDING'>, number>;
        findingTypes: KsReconciliationFinding['finding_type'][];
        totalAmountDeltaRub: number;
    };
    findings: KsReconciliationFinding[];
    reportLineage: ProtoLineage;
    nextActions: string[];
}
export declare function loadKsReconciliationFixturePackage(): KsReconciliationFixturePackage;
export declare function buildKsReconciliationReviewPack(runId: string): KsReconciliationReviewPack;
export declare function reviewKsReconciliationFinding(reviewPack: KsReconciliationReviewPack, input: {
    findingId: string;
    action: KsReconciliationFindingReviewAction;
    reviewerId: string;
    reviewedAt: string;
    reviewerComment?: string | null;
}): KsReconciliationReviewPack;
export declare function buildKsReconciliationFinalReport(runId: string, approvalId: string, reviewPack: KsReconciliationReviewPack): KsReconciliationFinalReport;
export {};
//# sourceMappingURL=ks-reconciliation-fixture.d.ts.map