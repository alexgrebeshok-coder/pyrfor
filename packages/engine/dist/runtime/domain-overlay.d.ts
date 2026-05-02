import type { ContextFactInput, CompileContextInput } from './context-compiler';
import type { AddDagNodeInput, DagCompensationPolicy, DagProvenanceLink, DagRetryClass, DagTimeoutClass } from './durable-dag';
import type { PermissionClass } from './permission-engine';
export type DomainOverlaySchemaVersion = 'domain_overlay.v1';
export type DomainAdapterKind = 'connector' | 'tool' | 'mcp';
export type DomainPrivacyAppliesTo = 'context' | 'effect' | 'audit';
export type DomainPrivacyEffect = 'allow' | 'ask' | 'deny' | 'redact';
export interface DomainSchemaRef {
    id: string;
    version?: string;
    schema: unknown;
}
export interface DomainWorkflowNode {
    id: string;
    kind: string;
    dependsOn?: string[];
    payload?: Record<string, unknown>;
    retryClass?: DagRetryClass;
    timeoutClass?: DagTimeoutClass;
    compensation?: DagCompensationPolicy;
    provenance?: DagProvenanceLink[];
}
export interface DomainWorkflowTemplate {
    id: string;
    title: string;
    taskSchemaId?: string;
    nodes: DomainWorkflowNode[];
}
export interface DomainAdapterRegistration {
    kind: DomainAdapterKind;
    id: string;
    target: string;
    config?: Record<string, unknown>;
}
export interface DomainPrivacyRule {
    id: string;
    appliesTo: DomainPrivacyAppliesTo;
    toolName?: string;
    effect: DomainPrivacyEffect;
    note?: string;
}
export interface DomainOverlayManifest {
    schemaVersion: DomainOverlaySchemaVersion;
    domainId: string;
    version: string;
    title: string;
    taskSchemas?: DomainSchemaRef[];
    eventSchemas?: DomainSchemaRef[];
    workflowTemplates?: DomainWorkflowTemplate[];
    adapterRegistrations?: DomainAdapterRegistration[];
    privacyRules?: DomainPrivacyRule[];
    toolPermissionOverrides?: Record<string, PermissionClass>;
    staticPolicyFacts?: ContextFactInput[];
    staticDomainFacts?: ContextFactInput[];
}
export interface DomainOverlayContext {
    workspaceId?: string;
    projectId?: string;
    runId?: string;
    taskId?: string;
    templateId?: string;
    task?: CompileContextInput['task'];
}
export interface DomainOverlayHooks {
    buildPolicyFacts?(manifest: DomainOverlayManifest, ctx: DomainOverlayContext): ContextFactInput[] | Promise<ContextFactInput[]>;
    buildDomainFacts?(manifest: DomainOverlayManifest, ctx: DomainOverlayContext): ContextFactInput[] | Promise<ContextFactInput[]>;
}
export interface DomainOverlayRegistration {
    manifest: DomainOverlayManifest;
    hooks?: DomainOverlayHooks;
}
export interface DomainContextFacts {
    policyFacts: ContextFactInput[];
    domainFacts: ContextFactInput[];
}
export interface InstantiateWorkflowOptions {
    idPrefix?: string;
    payload?: Record<string, unknown>;
    provenance?: DagProvenanceLink[];
}
export declare class DomainOverlayRegistry {
    private readonly overlays;
    register(registration: DomainOverlayRegistration): void;
    get(domainId: string): DomainOverlayRegistration | undefined;
    list(): DomainOverlayManifest[];
    resolveToolPermissionOverrides(domainIds: string[]): Record<string, PermissionClass>;
    resolveContextFacts(domainIds: string[], ctx?: DomainOverlayContext): Promise<DomainContextFacts>;
    enrichCompileInput(input: CompileContextInput, options: {
        domainIds: string[];
        context?: DomainOverlayContext;
    }): Promise<CompileContextInput>;
    instantiateWorkflow(domainId: string, templateId: string, options?: InstantiateWorkflowOptions): AddDagNodeInput[];
    private require;
}
export declare function mergeContextFacts(facts: ContextFactInput[]): ContextFactInput[];
export declare function materializeWorkflowTemplate(manifest: DomainOverlayManifest, template: DomainWorkflowTemplate, options?: InstantiateWorkflowOptions): AddDagNodeInput[];
//# sourceMappingURL=domain-overlay.d.ts.map