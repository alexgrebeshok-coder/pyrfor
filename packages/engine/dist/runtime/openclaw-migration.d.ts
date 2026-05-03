import type { ArtifactRef, ArtifactStore } from './artifact-model';
import { type MemoryType, type MemoryWriteOptions } from '../ai/memory/agent-memory-store';
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
    imported: number;
    skipped: number;
    memoryIds: string[];
    artifact: ArtifactRef;
}
export interface OpenClawMigrationDeps {
    artifactStore: ArtifactStore;
    memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
    now?: () => Date;
}
export declare function previewOpenClawMigration(deps: OpenClawMigrationDeps, options: OpenClawMigrationOptions): Promise<OpenClawMigrationPreviewResult>;
export declare function importOpenClawMigration(deps: OpenClawMigrationDeps, input: {
    report?: OpenClawMigrationReport;
    expectedReportSha256?: string;
    reportArtifact?: ArtifactRef;
    allowNonCanonicalSourceRoot?: boolean;
}): Promise<OpenClawMigrationImportResult>;
export declare function isAllowedOpenClawReportSourceRoot(report: OpenClawMigrationReport): boolean;
export declare function discoverOpenClawSourceRoots(): Promise<string[]>;
export declare function buildOpenClawMigrationReport(deps: Pick<OpenClawMigrationDeps, 'now'>, options: OpenClawMigrationOptions): Promise<OpenClawMigrationReport>;
//# sourceMappingURL=openclaw-migration.d.ts.map