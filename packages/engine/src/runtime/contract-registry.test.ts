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
});
