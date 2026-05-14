export interface DecisionRecord {
    id: string;
    nodeId: string;
    nodeHash: string;
    attempt: number;
    selectedAlternative: string;
    alternativesConsidered: string[];
    rationale: string;
    evidenceRefs: string[];
    budgetImpact?: {
        estimatedTokens?: number;
        estimatedUsd?: number;
        estimatedWallMs?: number;
    };
    timestamp: string;
    supersedesDecisionId?: string;
    nodeStartedAt?: string;
    lessonsConsidered?: LessonDecisionImpact[];
}
export interface LessonDecisionImpact {
    lessonId: string;
    lessonSnapshotHash: string;
    disposition: 'followed' | 'adapted' | 'rejected_as_not_applicable' | 'overridden';
    affectedAlternatives?: string[];
    changedSelectedAlternative: boolean;
    impactSummary: string;
}
export type DecisionPoisonSignalCode = 'duplicate_evidence_set' | 'near_duplicate_rationale' | 'low_rationale_entropy' | 'conflicting_same_node_hash' | 'budget_inflation_without_new_evidence' | 'out_of_sequence_write' | 'excessive_records_without_progress';
export interface DecisionPoisonSignal {
    code: DecisionPoisonSignalCode;
    score: number;
    details?: string;
}
export interface DecisionRecordAssessment {
    canonical: boolean;
    quarantined: boolean;
    block: boolean;
    safetyBlock: boolean;
    poisonScore: number;
    signals: DecisionPoisonSignal[];
    canonicalRecordId?: string;
}
export interface DecisionRecordAuditInput {
    record: DecisionRecord;
    peerRecords?: DecisionRecord[];
    progressEvents?: Array<{
        type: string;
        ts?: string;
        nodeId?: string;
    }>;
}
export declare function assessDecisionRecord(input: DecisionRecordAuditInput): DecisionRecordAssessment;
export declare function hashEvidenceRefs(evidenceRefs: string[]): string;
//# sourceMappingURL=decision-record-auditor.d.ts.map