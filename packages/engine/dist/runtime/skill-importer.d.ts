import type { ArtifactStore } from './artifact-model';
import type { RegistryEntry, SandboxTier, ToolCapabilityManifest, ToolRegistry, ToolStatus } from './universal/tool-registry';
export declare const MAX_SKILL_MD_BYTES: number;
export interface SkillImportRequest {
    content: string;
    sourceLabel?: string;
}
export interface SkillValidationCheck {
    id: string;
    description: string;
    passed: boolean;
}
export interface PublicToolRegistryEntry {
    id: string;
    name: string;
    kind: RegistryEntry['kind'];
    status: ToolStatus;
    capability: ToolCapabilityManifest;
    artifactId: string;
    testSuiteArtifactId: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    tags: string[];
    quality: {
        testsPassed: boolean;
        lastTestResultArtifactId?: string;
        failureScore: number;
        sandboxTier: SandboxTier;
        approvalRequired: boolean;
        provenance: 'imported' | 'forged' | 'adapted' | 'user-authored' | 'bundled' | 'unknown';
        provenanceTrust: 'quarantined' | 'sandboxed' | 'vetted' | 'trusted' | 'core';
    };
}
export interface SkillImportResult {
    schemaVersion: 'pyrfor.skill_import.v1';
    imported: boolean;
    duplicate: boolean;
    entry: PublicToolRegistryEntry;
    warnings: string[];
}
export interface ToolRegistryListResult {
    schemaVersion: 'pyrfor.tool_registry.v1';
    total: number;
    tools: PublicToolRegistryEntry[];
}
export interface SkillTestResult {
    schemaVersion: 'pyrfor.skill_test.v1';
    passed: boolean;
    skillRef: string;
    checks: SkillValidationCheck[];
    failureScore: number;
    testResultArtifactId: string;
    entry: PublicToolRegistryEntry;
}
export interface SkillApprovalResult {
    schemaVersion: 'pyrfor.skill_approval.v1';
    approved: boolean;
    alreadyApproved: boolean;
    skillRef: string;
    promotedFrom: ToolStatus;
    promotedTo: ToolStatus;
    entry: PublicToolRegistryEntry;
}
export declare function importSkillMdToRegistry(registry: ToolRegistry, request: SkillImportRequest): SkillImportResult;
export declare function listPublicToolRegistry(registry: ToolRegistry, query?: {
    status?: ToolStatus | 'active';
    tags?: string[];
    limit?: number;
}): ToolRegistryListResult;
export declare function testSkillRegistryEntry(registry: ToolRegistry, skillRef: string, deps?: {
    artifactStore?: Pick<ArtifactStore, 'writeJSON'>;
}): Promise<SkillTestResult>;
export declare function approveSkillRegistryEntry(registry: ToolRegistry, skillRef: string): SkillApprovalResult;
export declare function publicToolRegistryEntry(entry: RegistryEntry): PublicToolRegistryEntry;
//# sourceMappingURL=skill-importer.d.ts.map