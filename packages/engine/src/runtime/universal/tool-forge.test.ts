import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createToolRegistry, type ToolCapabilityManifest } from './tool-registry';
import {
  evaluateToolForgeGate,
  evictToolOnRegression,
  forgeToolCandidate,
  SelfExtensionLoop,
  ToolForgeValidationError,
  type ToolForgeInput,
} from './tool-forge';

describe('ToolForge M11 skeleton', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-tool-forge-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('registers forged tools only as sandboxed_experiment', () => {
    const registry = createToolRegistry(dir);

    const result = forgeToolCandidate(registry, toolForgeInput({
      capability: manifest({ requiredTrustTier: 'trusted' }),
    }));

    expect(result.gate.mode).toBe('forge');
    expect(result.entry.status).toBe('sandboxed_experiment');
    expect(result.entry.capability.requiredTrustTier).toBe('pending_validation');
    expect(result.entry.forgedByConceptId).toBe('concept-1');
    expect(result.lesson).toMatchObject({
      schemaVersion: 'pyrfor.toolforge.lesson.v1',
      promotedStatus: 'sandboxed_experiment',
      toolId: result.entry.id,
    });
  });

  it('reuses a vetted tool with the same name instead of registering a duplicate', () => {
    const registry = createToolRegistry(dir);
    const first = registry.register({
      name: 'json-fetcher',
      kind: 'script',
      capability: manifest({ requiredTrustTier: 'vetted' }),
      implPath: '/workspace/tools/json-fetcher.ts',
      contentHash: 'hash-1',
      artifactId: 'artifact-source-existing',
      testSuiteArtifactId: 'artifact-tests-existing',
      status: 'vetted',
      tags: ['existing'],
    });

    const gate = evaluateToolForgeGate(registry, toolForgeInput({ name: 'json-fetcher', contentHash: 'hash-2' }));
    const second = forgeToolCandidate(registry, toolForgeInput({ name: 'json-fetcher', contentHash: 'hash-2' }));

    expect(gate).toMatchObject({ mode: 'reuse', existingToolId: first.id });
    expect(second.entry.id).toBe(first.id);
    expect(registry.loadAll()).toHaveLength(1);
  });

  it('does not reuse unvetted sandboxed experiments as ToolForge inputs', () => {
    const registry = createToolRegistry(dir);
    const first = forgeToolCandidate(registry, toolForgeInput({ name: 'json-fetcher', contentHash: 'hash-1' }));

    const gate = evaluateToolForgeGate(registry, toolForgeInput({ name: 'json-fetcher', contentHash: 'hash-2' }));
    const second = forgeToolCandidate(registry, toolForgeInput({
      name: 'json-fetcher',
      contentHash: 'hash-2',
      capability: manifest({ triggers: ['json-fetcher-v2'] }),
    }));

    expect(gate.mode).toBe('forge');
    expect(second.entry.id).not.toBe(first.entry.id);
    expect(registry.loadAll()).toHaveLength(2);
  });

  it('adapts only from a reusable parent tool', () => {
    const registry = createToolRegistry(dir);
    const parent = registry.register({
      name: 'parent-tool',
      kind: 'script',
      capability: manifest({ requiredTrustTier: 'vetted' }),
      implPath: '/workspace/tools/parent.ts',
      contentHash: 'parent-hash',
      artifactId: 'artifact-parent-source',
      testSuiteArtifactId: 'artifact-parent-tests',
      status: 'vetted',
      tags: ['existing'],
    });

    const adapted = forgeToolCandidate(registry, toolForgeInput({
      name: 'adapted-tool',
      contentHash: 'adapted-hash',
      parentToolId: parent.id,
      capability: manifest({ triggers: ['adapted'] }),
    }));

    expect(adapted.gate.mode).toBe('adapt');
    expect(adapted.entry.parentToolId).toBe(parent.id);
  });

  it('rejects hash collisions with promoted tools instead of inheriting trust', () => {
    const registry = createToolRegistry(dir);
    registry.register({
      name: 'trusted-tool',
      kind: 'script',
      capability: manifest({ requiredTrustTier: 'trusted' }),
      implPath: '/workspace/tools/trusted.ts',
      contentHash: 'shared-hash',
      artifactId: 'artifact-trusted-source',
      testSuiteArtifactId: 'artifact-trusted-tests',
      status: 'trusted',
      tags: ['existing'],
    });

    expect(() => forgeToolCandidate(registry, toolForgeInput({
      name: 'new-tool',
      contentHash: 'shared-hash',
      capability: manifest({ triggers: ['unique-new-tool'] }),
    }))).toThrow(/contentHash collision/);
  });

  it('rejects hash collisions with sandboxed experiments instead of reusing unvetted tools', () => {
    const registry = createToolRegistry(dir);
    const first = forgeToolCandidate(registry, toolForgeInput({
      name: 'sandbox-a',
      contentHash: 'shared-sandbox-hash',
      capability: manifest({ triggers: ['sandbox-a'] }),
    }));

    expect(() => forgeToolCandidate(registry, toolForgeInput({
      conceptId: 'concept-2',
      name: 'sandbox-b',
      contentHash: first.entry.contentHash,
      capability: manifest({ triggers: ['sandbox-b'] }),
    }))).toThrow(/contentHash collision/);
    expect(registry.loadAll()).toHaveLength(1);
  });

  it('requires static analysis and dynamic tests before registration', () => {
    const registry = createToolRegistry(dir);

    expect(() => forgeToolCandidate(registry, toolForgeInput({
      staticAnalysis: { artifactId: 'static-fail', passed: false, findings: ['unsafe eval'] },
    }))).toThrow(/static analysis failed/);
    expect(() => forgeToolCandidate(registry, toolForgeInput({
      dynamicTests: { artifactId: 'test-fail', passed: false, findings: ['acceptance failed'] },
    }))).toThrow(/dynamic tests failed/);
    expect(registry.loadAll()).toHaveLength(0);
  });

  it('requires all TOC gate artifacts before ToolForge starts', () => {
    const registry = createToolRegistry(dir);

    expect(() => forgeToolCandidate(registry, toolForgeInput({
      tocGate: {
        bottleneck_proof: 'bottleneck',
        reuse_analysis: '',
        adaptation_impossible_justification: 'adaptation',
        forge_justification: 'forge',
      },
    }))).toThrow(/TOC gate missing artifacts: reuse_analysis/);
    expect(registry.loadAll()).toHaveLength(0);
  });

  it('rejects privileged sandbox tiers', () => {
    const registry = createToolRegistry(dir);

    expect(() => forgeToolCandidate(registry, toolForgeInput({
      capability: manifest({ requiredSandboxTier: 'host' }),
    }))).toThrow(ToolForgeValidationError);
  });

  it('requires explicit egress allowlist for network effects', () => {
    const registry = createToolRegistry(dir);

    expect(() => forgeToolCandidate(registry, toolForgeInput({
      capability: manifest({ declaredEffects: ['net.out'], egressAllowlist: [] }),
    }))).toThrow(/egressAllowlist/);
  });

  it('SelfExtensionLoop delegates through the same safe forge path', () => {
    const registry = createToolRegistry(dir);
    const loop = new SelfExtensionLoop(registry);

    const result = loop.forge(toolForgeInput({ name: 'loop-tool' }));

    expect(result.entry.name).toBe('loop-tool');
    expect(result.entry.status).toBe('sandboxed_experiment');
  });

  it('evicts regressed tools when failure score crosses threshold', () => {
    const registry = createToolRegistry(dir);
    const result = forgeToolCandidate(registry, toolForgeInput({ name: 'flaky-tool' }));

    expect(evictToolOnRegression(registry, result.entry.id, 0.5, 0.75)).toMatchObject({ evicted: false });
    const eviction = evictToolOnRegression(registry, result.entry.id, 0.8, 0.75);

    expect(eviction).toMatchObject({ evicted: true });
    expect(registry.get(result.entry.id)?.status).toBe('retired');
  });
});

function toolForgeInput(overrides: Partial<ToolForgeInput> = {}): ToolForgeInput {
  return {
    conceptId: 'concept-1',
    runId: 'run-1',
    name: 'example-tool',
    kind: 'script',
    implPath: '/workspace/tools/example.ts',
    contentHash: 'hash-default',
    artifactId: 'artifact-source',
    testSuiteArtifactId: 'artifact-tests',
    capability: manifest(),
    tags: ['test'],
    tocGate: {
      bottleneck_proof: 'artifact-bottleneck',
      reuse_analysis: 'artifact-reuse',
      adaptation_impossible_justification: 'artifact-adaptation',
      forge_justification: 'artifact-forge',
    },
    staticAnalysis: { artifactId: 'artifact-static', passed: true, findings: ['no taint found'] },
    dynamicTests: { artifactId: 'artifact-dynamic', passed: true, findings: ['acceptance passed'] },
    ...overrides,
  };
}

function manifest(overrides: Partial<ToolCapabilityManifest> = {}): ToolCapabilityManifest {
  return {
    description: 'Example forged tool',
    triggers: ['example'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    declaredEffects: ['fs.read'],
    requiredTrustTier: 'pending_validation',
    requiredSandboxTier: 'container_no_net',
    fsScope: ['/workspace'],
    ...overrides,
  };
}
