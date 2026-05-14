import type { RegistryEntry, SandboxTier, ToolCapabilityManifest, ToolRegistry, ToolStatus } from './universal/tool-registry';
export declare const MAX_SKILL_MD_BYTES: number;
export interface SkillImportRequest {
    content: string;
    sourceLabel?: string;
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
export declare function importSkillMdToRegistry(registry: ToolRegistry, request: SkillImportRequest): SkillImportResult;
export declare function listPublicToolRegistry(registry: ToolRegistry, query?: {
    status?: ToolStatus | 'active';
    tags?: string[];
    limit?: number;
}): ToolRegistryListResult;
export declare function publicToolRegistryEntry(entry: RegistryEntry): PublicToolRegistryEntry;
//# sourceMappingURL=skill-importer.d.ts.map