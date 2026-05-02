import type {
  ContextFactInput,
  CompileContextInput,
} from './context-compiler';
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

export class DomainOverlayRegistry {
  private readonly overlays = new Map<string, DomainOverlayRegistration>();

  register(registration: DomainOverlayRegistration): void {
    validateManifest(registration.manifest);
    const domainId = registration.manifest.domainId;
    if (this.overlays.has(domainId)) {
      throw new Error(`DomainOverlayRegistry: duplicate domainId "${domainId}"`);
    }
    this.overlays.set(domainId, registration);
  }

  get(domainId: string): DomainOverlayRegistration | undefined {
    return this.overlays.get(domainId);
  }

  list(): DomainOverlayManifest[] {
    return Array.from(this.overlays.values())
      .map((registration) => registration.manifest)
      .sort((a, b) => a.domainId.localeCompare(b.domainId));
  }

  resolveToolPermissionOverrides(domainIds: string[]): Record<string, PermissionClass> {
    const overrides: Record<string, PermissionClass> = {};
    for (const domainId of sortedUnique(domainIds)) {
      const manifest = this.require(domainId).manifest;
      Object.assign(overrides, manifest.toolPermissionOverrides ?? {});
    }
    return overrides;
  }

  async resolveContextFacts(
    domainIds: string[],
    ctx: DomainOverlayContext = {},
  ): Promise<DomainContextFacts> {
    const policyFacts: ContextFactInput[] = [];
    const domainFacts: ContextFactInput[] = [];

    for (const domainId of sortedUnique(domainIds)) {
      const registration = this.require(domainId);
      const manifest = registration.manifest;
      policyFacts.push(...manifestToPolicyFacts(manifest));
      domainFacts.push(...(manifest.staticDomainFacts ?? []));

      if (registration.hooks?.buildPolicyFacts) {
        policyFacts.push(...await registration.hooks.buildPolicyFacts(manifest, ctx));
      }
      if (registration.hooks?.buildDomainFacts) {
        domainFacts.push(...await registration.hooks.buildDomainFacts(manifest, ctx));
      }
    }

    return {
      policyFacts: mergeContextFacts(policyFacts),
      domainFacts: mergeContextFacts(domainFacts),
    };
  }

  async enrichCompileInput(
    input: CompileContextInput,
    options: { domainIds: string[]; context?: DomainOverlayContext },
  ): Promise<CompileContextInput> {
    const facts = await this.resolveContextFacts(options.domainIds, {
      ...options.context,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      runId: input.runId,
      task: input.task,
    });

    return {
      ...input,
      policyFacts: mergeContextFacts([...(input.policyFacts ?? []), ...facts.policyFacts]),
      domainFacts: mergeContextFacts([...(input.domainFacts ?? []), ...facts.domainFacts]),
    };
  }

  instantiateWorkflow(
    domainId: string,
    templateId: string,
    options: InstantiateWorkflowOptions = {},
  ): AddDagNodeInput[] {
    const manifest = this.require(domainId).manifest;
    const template = manifest.workflowTemplates?.find((candidate) => candidate.id === templateId);
    if (!template) {
      throw new Error(`DomainOverlayRegistry: unknown workflow template "${domainId}/${templateId}"`);
    }

    return materializeWorkflowTemplate(manifest, template, options);
  }

  private require(domainId: string): DomainOverlayRegistration {
    const registration = this.overlays.get(domainId);
    if (!registration) throw new Error(`DomainOverlayRegistry: unknown domainId "${domainId}"`);
    return registration;
  }
}

export function mergeContextFacts(facts: ContextFactInput[]): ContextFactInput[] {
  const byId = new Map<string, ContextFactInput>();
  for (const fact of facts) {
    byId.set(fact.id, fact);
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function materializeWorkflowTemplate(
  manifest: DomainOverlayManifest,
  template: DomainWorkflowTemplate,
  options: InstantiateWorkflowOptions = {},
): AddDagNodeInput[] {
  const prefix = options.idPrefix ?? `${manifest.domainId}/${template.id}`;
  const nodeId = (id: string): string => `${prefix}/${id}`;

  return [...template.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({
      id: nodeId(node.id),
      kind: node.kind,
      payload: {
        ...(node.payload ?? {}),
        ...(options.payload ?? {}),
        domainId: manifest.domainId,
        templateId: template.id,
        taskSchemaId: template.taskSchemaId,
      },
      dependsOn: (node.dependsOn ?? []).map(nodeId).sort(),
      idempotencyKey: `${manifest.domainId}:${template.id}:${node.id}`,
      retryClass: node.retryClass ?? 'transient',
      timeoutClass: node.timeoutClass ?? 'normal',
      compensation: node.compensation ?? { kind: 'none' },
      provenance: [
        ...(node.provenance ?? []),
        ...(options.provenance ?? []),
        {
          kind: 'ledger_event' as const,
          ref: `domain-overlay:${manifest.domainId}:${template.id}:${node.id}`,
          role: 'input' as const,
          meta: { domainId: manifest.domainId, templateId: template.id },
        },
      ],
    }));
}

function manifestToPolicyFacts(manifest: DomainOverlayManifest): ContextFactInput[] {
  const facts: ContextFactInput[] = [...(manifest.staticPolicyFacts ?? [])];

  for (const rule of manifest.privacyRules ?? []) {
    facts.push({
      id: `${manifest.domainId}:privacy:${rule.id}`,
      content: rule,
      source: {
        kind: 'policy',
        ref: `${manifest.domainId}/privacy/${rule.id}`,
        role: 'policy',
        meta: { domainId: manifest.domainId, effect: rule.effect },
      },
    });
  }

  for (const [toolName, permission] of Object.entries(manifest.toolPermissionOverrides ?? {})) {
    facts.push({
      id: `${manifest.domainId}:tool-permission:${toolName}`,
      content: { toolName, permission },
      source: {
        kind: 'policy',
        ref: `${manifest.domainId}/tool/${toolName}`,
        role: 'policy',
        meta: { domainId: manifest.domainId, permission },
      },
    });
  }

  return facts;
}

function validateManifest(manifest: DomainOverlayManifest): void {
  if (manifest.schemaVersion !== 'domain_overlay.v1') {
    throw new Error(`DomainOverlayRegistry: unsupported schemaVersion "${manifest.schemaVersion}"`);
  }
  if (!manifest.domainId) throw new Error('DomainOverlayRegistry: manifest.domainId is required');
  if (!manifest.version) throw new Error('DomainOverlayRegistry: manifest.version is required');
  const nodeIds = new Set<string>();
  for (const template of manifest.workflowTemplates ?? []) {
    nodeIds.clear();
    for (const node of template.nodes) {
      if (nodeIds.has(node.id)) {
        throw new Error(`DomainOverlayRegistry: duplicate node "${node.id}" in template "${template.id}"`);
      }
      nodeIds.add(node.id);
    }
    for (const node of template.nodes) {
      for (const dep of node.dependsOn ?? []) {
        if (!nodeIds.has(dep)) {
          throw new Error(`DomainOverlayRegistry: unknown dependency "${dep}" in template "${template.id}"`);
        }
      }
    }
  }
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
