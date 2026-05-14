import type { RegistryEntry, ToolCapabilityManifest, ToolKind, ToolRegistry } from './tool-registry';
export type ToolForgeGateMode = 'reuse' | 'adapt' | 'forge';
export interface ToolForgeEvidence {
    artifactId: string;
    passed: boolean;
    findings?: string[];
}
export interface TocGateArtifactSet {
    bottleneck_proof: string;
    reuse_analysis: string;
    adaptation_impossible_justification: string;
    forge_justification: string;
}
export interface ToolForgeInput {
    conceptId: string;
    runId: string;
    name: string;
    kind: ToolKind;
    implPath: string;
    contentHash: string;
    artifactId: string;
    testSuiteArtifactId: string;
    capability: ToolCapabilityManifest;
    parentToolId?: string;
    tags?: string[];
    tocGate: TocGateArtifactSet;
    staticAnalysis: ToolForgeEvidence;
    dynamicTests: ToolForgeEvidence;
}
export interface ToolForgeGateDecision {
    mode: ToolForgeGateMode;
    reason: string;
    existingToolId?: string;
}
export interface ToolForgeLessonDocument {
    schemaVersion: 'pyrfor.toolforge.lesson.v1';
    runId: string;
    conceptId: string;
    toolId: string;
    mode: ToolForgeGateMode;
    evidenceArtifacts: string[];
    promotedStatus: 'sandboxed_experiment';
    findings: string[];
}
export interface ToolForgeResult {
    gate: ToolForgeGateDecision;
    entry: RegistryEntry;
    lesson: ToolForgeLessonDocument;
}
export interface ToolEvictionResult {
    evicted: boolean;
    entry?: RegistryEntry;
    reason: string;
}
export declare class ToolForgeValidationError extends Error {
    constructor(message: string);
}
export declare class SelfExtensionLoop {
    private readonly registry;
    constructor(registry: ToolRegistry);
    forge(input: ToolForgeInput): ToolForgeResult;
}
export declare function evaluateToolForgeGate(registry: ToolRegistry, input: Pick<ToolForgeInput, 'name' | 'capability' | 'parentToolId'>): ToolForgeGateDecision;
export declare function forgeToolCandidate(registry: ToolRegistry, input: ToolForgeInput): ToolForgeResult;
export declare function evictToolOnRegression(registry: ToolRegistry, toolId: string, failureScore: number, threshold?: number): ToolEvictionResult;
//# sourceMappingURL=tool-forge.d.ts.map