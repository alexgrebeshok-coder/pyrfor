// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  WORKER_MANIFEST_SCHEMA_VERSION,
  assertWorkerManifestDomainScope,
  materializeWorkerManifest,
  mergePermissionOverrides,
  mergePermissionProfiles,
  mergeWorkerDomainScopes,
  validateWorkerManifest,
  type WorkerManifest,
} from './worker-manifest';
import type { RuntimeWorkerOptions } from './index';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';

function manifest(overrides: Partial<WorkerManifest> = {}): WorkerManifest {
  return {
    schemaVersion: WORKER_MANIFEST_SCHEMA_VERSION,
    id: 'worker.example',
    version: '0.1.0',
    title: 'Example worker',
    transport: 'acp',
    protocolVersion: WORKER_PROTOCOL_VERSION,
    ...overrides,
  };
}

describe('WorkerManifest', () => {
  it('validates and materializes worker runtime options', () => {
    const parsed = validateWorkerManifest(manifest({
      domainIds: ['ceoclaw'],
      permissionProfile: 'strict',
      toolPermissionOverrides: { shell_exec: 'ask_every_time' },
      requiredFrameTypes: ['request_capability', 'proposed_command'],
    }));

    expect(parsed).toMatchObject({
      schemaVersion: 'worker_manifest.v1',
      transport: 'acp',
      protocolVersion: 'wp.v2',
    });
    expect(materializeWorkerManifest(parsed)).toMatchObject({
      transport: 'acp',
      domainIds: ['ceoclaw'],
      permissionProfile: 'strict',
      permissionOverrides: { shell_exec: 'ask_every_time' },
      requiredFrameTypes: ['request_capability', 'proposed_command'],
    });
  });

  it('rejects unsupported schema, protocol, permissions and frame types', () => {
    expect(() => validateWorkerManifest({ ...manifest(), schemaVersion: 'worker_manifest.v0' })).toThrow(/schemaVersion/);
    expect(() => validateWorkerManifest({ ...manifest(), protocolVersion: 'wp.v1' })).toThrow(/protocolVersion/);
    expect(() => validateWorkerManifest({
      ...manifest(),
      toolPermissionOverrides: { shell_exec: 'allow_everything' },
    })).toThrow(/toolPermissionOverrides/);
    expect(() => validateWorkerManifest({
      ...manifest(),
      requiredFrameTypes: ['native_tool_use'],
    })).toThrow(/requiredFrameTypes/);
  });

  it('merges profiles and permissions using most restrictive wins', () => {
    expect(mergePermissionProfiles('autonomous', 'standard', 'strict')).toBe('strict');
    expect(mergePermissionProfiles(undefined, 'autonomous')).toBe('autonomous');
    expect(mergePermissionOverrides(
      { shell_exec: 'deny', apply_patch: 'ask_once' },
      { shell_exec: 'auto_allow', apply_patch: 'ask_every_time' },
      { deploy: 'ask_once' },
    )).toEqual({
      shell_exec: 'deny',
      apply_patch: 'ask_every_time',
      deploy: 'ask_once',
    });
    expect(mergeWorkerDomainScopes(['ceoclaw'], ['ochag', 'ceoclaw'], undefined)).toEqual(['ceoclaw', 'ochag']);
    expect(mergeWorkerDomainScopes([], undefined)).toBeUndefined();
  });

  it('rejects worker manifest domains outside the run scope', () => {
    expect(() => assertWorkerManifestDomainScope(['ceoclaw'], ['ceoclaw', 'ochag'])).not.toThrow();
    expect(() => assertWorkerManifestDomainScope(['finance'], ['ceoclaw'])).toThrow(/out of run scope/);
  });

  it('allows typed manifest-only runtime worker options', () => {
    const options: RuntimeWorkerOptions = {
      manifest: manifest({ transport: 'freeclaude' }),
    };

    expect(options.manifest?.transport).toBe('freeclaude');
  });
});
