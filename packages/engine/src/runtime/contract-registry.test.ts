import { describe, expect, it } from 'vitest';
import { ContractRegistry, ContractRegistryError, parseContractRef } from './contract-registry';

describe('ContractRegistry', () => {
  it('parses Name@major refs', () => {
    expect(parseContractRef('ApprovalEvidence@1')).toEqual({
      ref: 'ApprovalEvidence@1',
      name: 'ApprovalEvidence',
      major: 1,
    });
  });

  it('rejects invalid contract refs', () => {
    expect(parseContractRef('ApprovalEvidence')).toBeNull();
    expect(parseContractRef('approvalEvidence@1')).toBeNull();
    expect(parseContractRef('ApprovalEvidence@0')).toBeNull();
    expect(parseContractRef('ApprovalEvidence@1.2')).toBeNull();
  });

  it('registers and looks up contract declarations', () => {
    const registry = new ContractRegistry();

    const entry = registry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.approvals',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:00.000Z',
    });

    expect(entry).toMatchObject({ name: 'ApprovalEvidence', major: 1 });
    expect(registry.get('ApprovalEvidence@1')).toMatchObject({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.approvals',
      direction: 'produces',
    });
    expect(registry.has('ApprovalEvidence@1')).toBe(true);
  });

  it('rejects duplicate Name@major registrations', () => {
    const registry = new ContractRegistry();
    registry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.approvals',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:00.000Z',
    });

    expect(() => registry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.other',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:01.000Z',
    })).toThrow(ContractRegistryError);
  });

  it('lists contracts by direction and block id', () => {
    const registry = new ContractRegistry();
    registry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.approvals',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:00.000Z',
    });
    registry.register({
      ref: 'Document@1',
      blockId: 'com.example.docs',
      direction: 'consumes',
      registeredAt: '2026-05-15T00:00:00.000Z',
      optional: true,
    });

    expect(registry.list()).toHaveLength(2);
    expect(registry.list({ direction: 'produces' }).map((entry) => entry.ref)).toEqual(['ApprovalEvidence@1']);
    expect(registry.list({ blockId: 'com.example.docs' }).map((entry) => entry.ref)).toEqual(['Document@1']);
  });

  it('clones schema metadata and provenance on register/get/list', () => {
    const registry = new ContractRegistry();
    const registered = registry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.approvals',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:00.000Z',
      schema: {
        path: 'contracts/approval-evidence.v1.schema.json',
        validate: true,
      },
      provenance: {
        source: 'block-manifest',
        manifestPath: '/Users/aleksandrgrebeshok/pyrfor-dev/examples/approval/block.json',
        blockVersion: '0.1.0',
        manifestRef: {
          id: 'artifact-1',
          kind: 'block_manifest',
          uri: '/Users/aleksandrgrebeshok/pyrfor-dev/examples/approval/artifacts/manifest.json',
          createdAt: '2026-05-15T00:00:00.000Z',
          meta: { blockId: 'com.example.approvals' },
        },
      },
    });

    registered.schema!.path = 'contracts/changed.schema.json';
    registered.provenance!.manifestPath = '/changed/block.json';
    registered.provenance!.manifestRef!.meta!['blockId'] = 'changed';

    const fetched = registry.get('ApprovalEvidence@1');
    expect(fetched).toMatchObject({
      schema: {
        path: 'contracts/approval-evidence.v1.schema.json',
        validate: true,
      },
      provenance: {
        source: 'block-manifest',
        manifestPath: '/Users/aleksandrgrebeshok/pyrfor-dev/examples/approval/block.json',
        blockVersion: '0.1.0',
        manifestRef: {
          kind: 'block_manifest',
          meta: { blockId: 'com.example.approvals' },
        },
      },
    });

    fetched!.schema!.validate = false;
    fetched!.provenance!.manifestRef!.meta!['blockId'] = 'mutated';

    expect(registry.list()).toEqual([
      expect.objectContaining({
        schema: {
          path: 'contracts/approval-evidence.v1.schema.json',
          validate: true,
        },
        provenance: expect.objectContaining({
          manifestPath: '/Users/aleksandrgrebeshok/pyrfor-dev/examples/approval/block.json',
          manifestRef: expect.objectContaining({
            meta: { blockId: 'com.example.approvals' },
          }),
        }),
      }),
    ]);
  });

  it('deep-clones nested manifestRef meta objects', () => {
    const registry = new ContractRegistry();
    const registered = registry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.approvals',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:00.000Z',
      provenance: {
        source: 'block-manifest',
        manifestPath: '/tmp/block.json',
        blockVersion: '0.1.0',
        manifestRef: {
          id: 'artifact-1',
          kind: 'block_manifest',
          uri: '/tmp/manifest.json',
          createdAt: '2026-05-15T00:00:00.000Z',
          meta: { nested: { value: 'original' } },
        },
      },
    });

    (registered.provenance!.manifestRef!.meta!['nested'] as { value: string }).value = 'mutated';

    expect((registry.get('ApprovalEvidence@1')!.provenance!.manifestRef!.meta!['nested'] as { value: string }).value).toBe('original');
  });
});
