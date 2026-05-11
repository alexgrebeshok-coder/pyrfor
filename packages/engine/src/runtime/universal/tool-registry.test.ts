import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createToolRegistry, type RegisterToolInput, type ToolCapabilityManifest } from './tool-registry';

describe('ToolRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-tool-registry-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('registers a pending validation tool with id, version, and timestamps', () => {
    const registry = createToolRegistry(dir);
    const entry = registry.register(toolInput({ name: 'curl-json', contentHash: 'hash-1' }));

    expect(entry.id).toBeTruthy();
    expect(entry.version).toBe(1);
    expect(entry.status).toBe('pending_validation');
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();
  });

  it('finds by kind and text query across description and triggers', () => {
    const registry = createToolRegistry(dir);
    registry.register(toolInput({
      name: 'curl-json',
      kind: 'script',
      contentHash: 'hash-1',
      capability: manifest({ description: 'Fetch JSON over HTTP', triggers: ['curl', 'http'] }),
    }));
    registry.register(toolInput({
      name: 'mcp-search',
      kind: 'mcp_tool',
      contentHash: 'hash-2',
      capability: manifest({ description: 'Search workspace symbols', triggers: ['symbols'] }),
    }));

    expect(registry.find({ kind: 'script' }).map((entry) => entry.name)).toEqual(['curl-json']);
    expect(registry.find({ q: 'workspace' }).map((entry) => entry.name)).toEqual(['mcp-search']);
  });

  it('dedupes registrations by content hash', () => {
    const registry = createToolRegistry(dir);
    const first = registry.register(toolInput({ name: 'tool-a', contentHash: 'same-hash' }));
    const second = registry.register(toolInput({ name: 'tool-b', contentHash: 'same-hash' }));

    expect(second.id).toBe(first.id);
    expect(registry.loadAll()).toHaveLength(1);
  });

  it('increments version for the same tool name with new content', () => {
    const registry = createToolRegistry(dir);
    registry.register(toolInput({ name: 'curl-json', contentHash: 'hash-1' }));
    const second = registry.register(toolInput({ name: 'curl-json', contentHash: 'hash-2' }));

    expect(second.version).toBe(2);
    expect(registry.getByName('curl-json')?.contentHash).toBe('hash-2');
  });

  it('retires entries and active queries exclude retired tools', () => {
    const registry = createToolRegistry(dir);
    const entry = registry.register(toolInput({ name: 'curl-json', contentHash: 'hash-1' }));

    const retired = registry.retire(entry.id, 'regression');

    expect(retired?.status).toBe('retired');
    expect(retired?.retiredAt).toBeTruthy();
    expect(retired?.trustHistory[0]).toMatchObject({
      from: 'pending_validation',
      to: 'retired',
      reason: 'regression',
    });
    expect(registry.find({ status: 'active' })).toHaveLength(0);
  });

  it('persists and reloads registry entries from disk', () => {
    const registry = createToolRegistry(dir);
    registry.register(toolInput({ name: 'curl-json', contentHash: 'hash-1' }));
    registry.register(toolInput({ name: 'mcp-search', contentHash: 'hash-2' }));

    const reloaded = createToolRegistry(dir);

    expect(reloaded.loadAll().map((entry) => entry.name).sort()).toEqual(['curl-json', 'mcp-search']);
  });
});

function toolInput(overrides: Partial<RegisterToolInput> = {}): RegisterToolInput {
  return {
    name: 'example-tool',
    kind: 'script',
    capability: manifest(),
    implPath: '/tmp/example-tool.ts',
    contentHash: 'hash-default',
    artifactId: 'artifact-tool-source',
    testSuiteArtifactId: 'artifact-tool-tests',
    tags: ['universal'],
    ...overrides,
  };
}

function manifest(overrides: Partial<ToolCapabilityManifest> = {}): ToolCapabilityManifest {
  return {
    description: 'Example tool',
    triggers: ['example'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    declaredEffects: ['fs.read'],
    requiredTrustTier: 'pending_validation',
    requiredSandboxTier: 'wasm',
    ...overrides,
  };
}
