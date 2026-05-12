import type {
  RegisterToolInput,
  RegistryEntry,
  ToolCapabilityManifest,
  ToolKind,
  ToolRegistry,
  ToolStatus,
} from './tool-registry';

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

export class ToolForgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolForgeValidationError';
  }
}

export class SelfExtensionLoop {
  constructor(private readonly registry: ToolRegistry) {}

  forge(input: ToolForgeInput): ToolForgeResult {
    return forgeToolCandidate(this.registry, input);
  }
}

export function evaluateToolForgeGate(registry: ToolRegistry, input: Pick<ToolForgeInput, 'name' | 'capability' | 'parentToolId'>): ToolForgeGateDecision {
  const exact = registry.getByName(input.name);
  if (exact && isReusableToolStatus(exact.status)) {
    return { mode: 'reuse', reason: `active tool already exists: ${input.name}`, existingToolId: exact.id };
  }

  for (const trigger of input.capability.triggers) {
    const matching = registry.loadAll().find((entry) => isReusableToolStatus(entry.status) && toolMatchesTrigger(entry, trigger));
    if (matching) {
      return { mode: 'reuse', reason: `vetted tool already covers trigger: ${trigger}`, existingToolId: matching.id };
    }
  }

  if (input.parentToolId) {
    const parent = registry.get(input.parentToolId);
    if (!parent || !isReusableToolStatus(parent.status)) {
      throw new ToolForgeValidationError(`parent tool is not reusable: ${input.parentToolId}`);
    }
    return { mode: 'adapt', reason: `adapting parent tool: ${input.parentToolId}`, existingToolId: input.parentToolId };
  }

  return { mode: 'forge', reason: 'no reusable active tool found' };
}

export function forgeToolCandidate(registry: ToolRegistry, input: ToolForgeInput): ToolForgeResult {
  validateToolForgeInput(input);
  const gate = evaluateToolForgeGate(registry, input);
  if (gate.mode === 'reuse') {
    const existing = registry.get(gate.existingToolId!);
    if (!existing) throw new ToolForgeValidationError(`reuse target disappeared: ${gate.existingToolId}`);
    return {
      gate,
      entry: existing,
      lesson: buildLesson(input, existing, gate),
    };
  }

  assertNoToolForgeHashCollision(registry, input.contentHash);

  const entry = registry.register({
    name: input.name,
    kind: input.kind,
    capability: normalizeCapability(input.capability),
    implPath: input.implPath,
    contentHash: input.contentHash,
    artifactId: input.artifactId,
    testSuiteArtifactId: input.testSuiteArtifactId,
    forgedByConceptId: input.conceptId,
    parentToolId: input.parentToolId,
    tags: ['universal', 'toolforge', ...(input.tags ?? [])],
    status: 'sandboxed_experiment',
    trustHistory: [{
      at: new Date(0).toISOString(),
      from: 'pending_validation',
      to: 'sandboxed_experiment',
      reason: 'ToolForge M11 registration is sandbox-only until verifier promotion',
      runId: input.runId,
    }],
  } satisfies RegisterToolInput);

  return {
    gate,
    entry,
    lesson: buildLesson(input, entry, gate),
  };
}

export function evictToolOnRegression(
  registry: ToolRegistry,
  toolId: string,
  failureScore: number,
  threshold = 0.75,
): ToolEvictionResult {
  if (!Number.isFinite(failureScore) || failureScore < 0 || failureScore > 1) {
    throw new ToolForgeValidationError('failureScore must be between 0 and 1');
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new ToolForgeValidationError('threshold must be between 0 and 1');
  }
  const entry = registry.get(toolId);
  if (!entry) return { evicted: false, reason: `tool not found: ${toolId}` };
  if (entry.status === 'retired') return { evicted: false, entry, reason: 'tool already retired' };
  if (failureScore < threshold) return { evicted: false, entry, reason: 'failure score below eviction threshold' };
  const retired = registry.retire(toolId, `ToolForge regression eviction: failureScore=${failureScore}`);
  return { evicted: true, entry: retired, reason: 'failure score exceeded eviction threshold' };
}

function validateToolForgeInput(input: ToolForgeInput): void {
  if (!input.name.trim()) throw new ToolForgeValidationError('tool name is required');
  if (!input.contentHash.trim()) throw new ToolForgeValidationError('contentHash is required');
  if (!input.artifactId.trim()) throw new ToolForgeValidationError('artifactId is required');
  if (!input.testSuiteArtifactId.trim()) throw new ToolForgeValidationError('testSuiteArtifactId is required');
  if (!input.staticAnalysis.passed) {
    throw new ToolForgeValidationError(`static analysis failed: ${(input.staticAnalysis.findings ?? []).join('; ') || 'no details'}`);
  }
  if (!input.dynamicTests.passed) {
    throw new ToolForgeValidationError(`dynamic tests failed: ${(input.dynamicTests.findings ?? []).join('; ') || 'no details'}`);
  }
  validateTocGate(input.tocGate);
  if (input.capability.requiredSandboxTier === 'host' || input.capability.requiredSandboxTier === 'container_full') {
    throw new ToolForgeValidationError(`ToolForge cannot create privileged sandbox tier: ${input.capability.requiredSandboxTier}`);
  }
  if (
    (input.capability.declaredEffects.includes('net.out') || input.capability.declaredEffects.includes('net.in')) &&
    (input.capability.egressAllowlist ?? []).length === 0
  ) {
    throw new ToolForgeValidationError('network effects require an explicit egressAllowlist');
  }
}

function validateTocGate(tocGate: TocGateArtifactSet): void {
  const missing = Object.entries(tocGate)
    .filter(([, value]) => value.trim().length === 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new ToolForgeValidationError(`TOC gate missing artifacts: ${missing.join(', ')}`);
  }
}

function assertNoToolForgeHashCollision(registry: ToolRegistry, contentHash: string): void {
  const existing = registry.loadAll().find((entry) => entry.contentHash === contentHash);
  if (!existing) return;
  throw new ToolForgeValidationError(
    `contentHash collision with existing tool: ${existing.id} (${existing.status})`,
  );
}

function isReusableToolStatus(status: ToolStatus): boolean {
  return status === 'vetted' || status === 'trusted' || status === 'core';
}

function toolMatchesTrigger(entry: RegistryEntry, trigger: string): boolean {
  const needle = trigger.trim().toLowerCase();
  if (!needle) return false;
  return [
    entry.name,
    entry.capability.description,
    ...entry.capability.triggers,
  ].join(' ').toLowerCase().includes(needle);
}

function normalizeCapability(capability: ToolCapabilityManifest): ToolCapabilityManifest {
  return {
    ...capability,
    requiredTrustTier: 'pending_validation',
  };
}

function buildLesson(input: ToolForgeInput, entry: RegistryEntry, gate: ToolForgeGateDecision): ToolForgeLessonDocument {
  return {
    schemaVersion: 'pyrfor.toolforge.lesson.v1',
    runId: input.runId,
    conceptId: input.conceptId,
    toolId: entry.id,
    mode: gate.mode,
    evidenceArtifacts: [
      input.tocGate.bottleneck_proof,
      input.tocGate.reuse_analysis,
      input.tocGate.adaptation_impossible_justification,
      input.tocGate.forge_justification,
      input.artifactId,
      input.testSuiteArtifactId,
      input.staticAnalysis.artifactId,
      input.dynamicTests.artifactId,
    ],
    promotedStatus: 'sandboxed_experiment',
    findings: [
      ...(input.staticAnalysis.findings ?? []),
      ...(input.dynamicTests.findings ?? []),
    ],
  };
}
