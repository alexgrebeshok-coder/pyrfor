import type { ArtifactRef, ArtifactStore } from './artifact-model';
import { revokeImportedMemories, searchMemory, type MemoryType, type MemoryWriteOptions } from '../ai/memory/agent-memory-store';
import type { ToolRegistry, ToolStatus } from './universal/tool-registry';
export interface OpenClawMigrationOptions {
    workspaceId: string;
    sourcePath?: string;
    projectId?: string;
    includePersonality?: boolean;
    includeMemories?: boolean;
    maxFiles?: number;
    allowNonCanonicalSourceRoot?: boolean;
}
export interface OpenClawMigrationEntry {
    sourceRelPath: string;
    sourceKind: 'personality' | 'memory' | 'skill';
    memoryType: MemoryType;
    fingerprint: string;
    bytes: number;
    mtime: string;
    summary: string;
    redactionCount: number;
}
export interface OpenClawMigrationSkipped {
    sourceRelPath: string;
    reason: string;
}
export interface OpenClawMigrationReport {
    schemaVersion: 'openclaw_migration_report.v1';
    generatedAt: string;
    workspaceId: string;
    projectId?: string;
    sourceRoot: string;
    counts: {
        importable: number;
        skipped: number;
        personality: number;
        memories: number;
        skills: number;
        redactions: number;
    };
    entries: OpenClawMigrationEntry[];
    skipped: OpenClawMigrationSkipped[];
}
export interface OpenClawMigrationPreviewResult {
    artifact: ArtifactRef;
    report: OpenClawMigrationReport;
}
export interface OpenClawMigrationImportResult {
    schemaVersion: 'openclaw_migration_result.v1';
    migrationId: string;
    imported: number;
    skipped: number;
    memoryIds: string[];
    importedEntries: OpenClawMigrationImportedEntry[];
    skippedEntries: OpenClawMigrationImportSkipped[];
    importedToolEntries: OpenClawMigrationImportedToolEntry[];
    skippedToolEntries: OpenClawMigrationSkippedToolEntry[];
    skillFinalizationSummary?: OpenClawMigrationSkillFinalizationSummary;
    rollbackPlan: OpenClawMigrationRollbackPlan;
    artifact: ArtifactRef;
}
export interface OpenClawMigrationImportedEntry {
    sourceRelPath: string;
    sourceKind: OpenClawMigrationEntry['sourceKind'];
    memoryType: MemoryType;
    fingerprint: string;
    memoryId: string;
}
export interface OpenClawMigrationImportSkipped {
    sourceRelPath: string;
    fingerprint: string;
    reason: 'fingerprint_mismatch';
}
export interface OpenClawMigrationImportedToolEntry {
    sourceRelPath: string;
    toolId: string;
    toolName: string;
    status: ToolStatus;
    duplicate: boolean;
    finalization?: OpenClawMigrationToolFinalization;
}
export interface OpenClawMigrationSkippedToolEntry {
    sourceRelPath: string;
    reason: 'invalid_skill_md' | 'skill_registry_import_failed';
}
export interface OpenClawMigrationToolFinalization {
    testAttempted: boolean;
    testPassed?: boolean;
    failureScore?: number;
    testResultArtifactId?: string;
    approvalAttempted: boolean;
    approvalGranted?: boolean;
    alreadyApproved?: boolean;
    finalStatus: ToolStatus;
    completedAt: string;
    error?: 'skill_not_found' | 'skill_retired' | 'skill_tests_required' | 'skill_validation_failed' | 'skill_finalization_failed';
}
export interface OpenClawMigrationSkillFinalizationSummary {
    autoTestSkills: boolean;
    autoApproveSkills: boolean;
    tested: number;
    passed: number;
    approved: number;
    testFailed: number;
    approvalFailed: number;
}
export interface OpenClawMigrationRollbackPlan {
    status: 'prepared_not_executed';
    action: 'revoke_imported_memories';
    memoryIds: string[];
    note: string;
}
export interface OpenClawMigrationResultDocument extends Omit<OpenClawMigrationImportResult, 'artifact'> {
    importedAt: string;
    reportArtifactId?: string;
    reportSha256?: string;
    workspaceId: string;
    projectId?: string;
}
export interface OpenClawMigrationRollbackResult {
    schemaVersion: 'openclaw_migration_rollback_result.v1';
    migrationId: string;
    workspaceId: string;
    projectId?: string;
    rolledBackAt: string;
    requested: number;
    matched: number;
    revoked: number;
    missingIds: string[];
    skippedIds: string[];
    alreadyRevokedIds: string[];
    artifact: ArtifactRef;
}
export interface OpenClawMigrationVerificationEntry {
    memoryId: string;
    sourceRelPath: string;
    sourceKind: OpenClawMigrationEntry['sourceKind'];
    memoryType: MemoryType;
    searchAttempts: number;
    foundInResults: boolean;
    matchedSummary?: string;
    searchFailed?: boolean;
    error?: string;
}
export interface OpenClawMigrationVerificationResult {
    schemaVersion: 'openclaw_migration_verification_result.v1';
    migrationId: string;
    verifiedAt: string;
    totalMemories: number;
    foundCount: number;
    missCount: number;
    searchAttemptsFailed: number;
    entries: OpenClawMigrationVerificationEntry[];
    artifact: ArtifactRef;
}
export type OpenClawMigrationAuditStatus = 'imported' | 'verified' | 'needs_review' | 'search_unverified' | 'rolled_back';
export interface OpenClawMigrationQuarantineCandidate {
    migrationId: string;
    memoryId: string;
    sourceRelPath: string;
    sourceKind: OpenClawMigrationEntry['sourceKind'];
    memoryType: MemoryType;
    reason: 'verification_missed' | 'verification_search_failed';
    verificationArtifactId: string;
    verificationSha256?: string;
}
export interface OpenClawMigrationAuditVerificationSummary {
    artifact: ArtifactRef;
    verifiedAt: string;
    totalMemories: number;
    foundCount: number;
    missCount: number;
    searchAttemptsFailed: number;
    quarantineCandidateCount: number;
    searchFailureCount: number;
}
export interface OpenClawMigrationAuditRollbackSummary {
    artifact: ArtifactRef;
    rolledBackAt: string;
    requested: number;
    matched: number;
    revoked: number;
    missingIds: string[];
    skippedIds: string[];
    alreadyRevokedIds: string[];
}
export interface OpenClawMigrationAuditMigration {
    migrationId: string;
    workspaceId: string;
    projectId?: string;
    status: OpenClawMigrationAuditStatus;
    importedAt: string;
    imported: number;
    skipped: number;
    memoryIds: string[];
    importArtifact: ArtifactRef;
    latestVerification?: OpenClawMigrationAuditVerificationSummary;
    latestRollback?: OpenClawMigrationAuditRollbackSummary;
    quarantineCandidates: OpenClawMigrationQuarantineCandidate[];
    searchFailures: OpenClawMigrationQuarantineCandidate[];
}
export interface OpenClawMigrationAuditWarning {
    artifactId: string;
    memoryKind?: string;
    reason: string;
}
export interface OpenClawMigrationAuditView {
    schemaVersion: 'openclaw_migration_audit.v1';
    generatedAt: string;
    workspaceId: string;
    projectId?: string;
    migrations: OpenClawMigrationAuditMigration[];
    quarantineCandidates: OpenClawMigrationQuarantineCandidate[];
    searchFailures: OpenClawMigrationQuarantineCandidate[];
    artifactCounts: {
        importResults: number;
        verificationResults: number;
        rollbackResults: number;
        invalidArtifacts: number;
    };
    warnings: OpenClawMigrationAuditWarning[];
}
export interface OpenClawMigrationQuarantineState {
    schemaVersion: 'openclaw_quarantine_state.v1';
    generatedAt: string;
    workspaceId: string;
    projectId?: string;
    candidateCount: number;
    searchFailureCount: number;
    candidates: OpenClawMigrationQuarantineCandidate[];
    searchFailures: OpenClawMigrationQuarantineCandidate[];
    sourceMigrationCount: number;
}
export interface OpenClawMigrationDeps {
    artifactStore: ArtifactStore;
    memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
    memoryRevoker?: typeof revokeImportedMemories;
    memorySearcher?: typeof searchMemory;
    toolRegistry?: ToolRegistry;
    now?: () => Date;
}
export declare function previewOpenClawMigration(deps: OpenClawMigrationDeps, options: OpenClawMigrationOptions): Promise<OpenClawMigrationPreviewResult>;
export declare function importOpenClawMigration(deps: OpenClawMigrationDeps, input: {
    report?: OpenClawMigrationReport;
    expectedReportSha256?: string;
    reportArtifact?: ArtifactRef;
    allowNonCanonicalSourceRoot?: boolean;
    autoTestSkills?: boolean;
    autoApproveSkills?: boolean;
}): Promise<OpenClawMigrationImportResult>;
export declare function rollbackOpenClawMigration(deps: OpenClawMigrationDeps, input: {
    resultArtifact: ArtifactRef;
    expectedResultSha256: string;
}): Promise<OpenClawMigrationRollbackResult>;
export declare function verifyOpenClawMigration(deps: OpenClawMigrationDeps, input: {
    resultArtifact: ArtifactRef;
    expectedResultSha256: string;
    queryLimit?: number;
}): Promise<OpenClawMigrationVerificationResult>;
export declare function buildOpenClawMigrationAudit(deps: OpenClawMigrationDeps, input: {
    workspaceId: string;
    projectId?: string;
    limit?: number;
}): Promise<OpenClawMigrationAuditView>;
export declare function buildOpenClawMigrationQuarantine(deps: OpenClawMigrationDeps, input: {
    workspaceId: string;
    projectId?: string;
    limit?: number;
}): Promise<OpenClawMigrationQuarantineState>;
export declare function isAllowedOpenClawReportSourceRoot(report: OpenClawMigrationReport): boolean;
export declare function discoverOpenClawSourceRoots(): Promise<string[]>;
export declare function buildOpenClawMigrationReport(deps: Pick<OpenClawMigrationDeps, 'now'>, options: OpenClawMigrationOptions): Promise<OpenClawMigrationReport>;
//# sourceMappingURL=openclaw-migration.d.ts.map