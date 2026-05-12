import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventLedger } from '../event-ledger';
import { capabilityFingerprint, ToolSlotManager } from './tool-slot-manager';

describe('ToolSlotManager', () => {
  let dir: string;
  let ledger: EventLedger;
  let manager: ToolSlotManager;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-tool-slots-'));
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
    manager = new ToolSlotManager(ledger, { softCap: 2, hardCap: 3 });
  });

  afterEach(async () => {
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reserves one slot per lineage capability fingerprint and emits ledger evidence', async () => {
    const first = await manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a' }));
    const duplicate = await manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a', runId: 'run-2' }));

    expect(first).toMatchObject({ status: 'reserved', activeSlotCount: 1 });
    expect(first.event).toMatchObject({
      type: 'tool.slot.reserved',
      parent_concept_id: 'root-concept',
      capability_fingerprint: 'cap-a',
    });
    expect(duplicate).toMatchObject({
      status: 'duplicate',
      activeSlotCount: 1,
      event: { id: first.event?.id },
    });
    expect((await ledger.readAll()).map((event) => event.type)).toEqual(['tool.slot.reserved']);
  });

  it('requires approval after the soft cap and blocks after the hard cap', async () => {
    await manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a' }));
    await manager.reserve(slotRequest({ capabilityFingerprint: 'cap-b' }));

    await expect(manager.reserve(slotRequest({ capabilityFingerprint: 'cap-c' }))).resolves.toMatchObject({
      status: 'blocked',
      reason: 'soft tool slot cap requires approval',
      activeSlotCount: 2,
    });
    await expect(manager.reserve(slotRequest({ capabilityFingerprint: 'cap-c', approvalId: 'approval-cap-c' }))).resolves.toMatchObject({
      status: 'reserved',
      activeSlotCount: 3,
    });
    await expect(manager.reserve(slotRequest({ capabilityFingerprint: 'cap-d', approvalId: 'approval-cap-d' }))).resolves.toMatchObject({
      status: 'blocked',
      reason: 'hard tool slot cap exhausted',
      activeSlotCount: 3,
    });
  });

  it('serializes concurrent reservations for the same lineage', async () => {
    manager = new ToolSlotManager(ledger, { softCap: 1, hardCap: 1 });

    const [first, second] = await Promise.all([
      manager.reserve(slotRequest({ capabilityFingerprint: 'same-cap', runId: 'run-a' })),
      manager.reserve(slotRequest({ capabilityFingerprint: 'same-cap', runId: 'run-b' })),
    ]);

    expect([first.status, second.status].sort()).toEqual(['duplicate', 'reserved']);
    expect(await manager.activeSlots('root-concept')).toHaveLength(1);

    const [third, fourth] = await Promise.all([
      manager.reserve(slotRequest({ capabilityFingerprint: 'cap-b', runId: 'run-c' })),
      manager.reserve(slotRequest({ capabilityFingerprint: 'cap-c', runId: 'run-d' })),
    ]);

    expect([third.status, fourth.status]).toEqual(['blocked', 'blocked']);
    expect(await manager.activeSlots('root-concept')).toHaveLength(1);
  });

  it('serializes concurrent reservations across managers sharing the same ledger path', async () => {
    manager = new ToolSlotManager(ledger, { softCap: 1, hardCap: 1 });
    const secondLedger = new EventLedger(ledger.storagePath);
    const secondManager = new ToolSlotManager(secondLedger, { softCap: 1, hardCap: 1 });
    try {
      const [first, second] = await Promise.all([
        manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a', runId: 'run-a' })),
        secondManager.reserve(slotRequest({ capabilityFingerprint: 'cap-b', runId: 'run-b' })),
      ]);

      expect([first.status, second.status].sort()).toEqual(['blocked', 'reserved']);
      expect(await manager.activeSlots('root-concept')).toHaveLength(1);
    } finally {
      await secondLedger.close();
    }
  });

  it('serializes concurrent reservations across absolute and relative ledger path aliases', async () => {
    manager = new ToolSlotManager(ledger, { softCap: 1, hardCap: 1 });
    const relativeLedger = new EventLedger(path.relative(process.cwd(), ledger.storagePath));
    const relativeManager = new ToolSlotManager(relativeLedger, { softCap: 1, hardCap: 1 });
    try {
      const [first, second] = await Promise.all([
        manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a', runId: 'run-a' })),
        relativeManager.reserve(slotRequest({ capabilityFingerprint: 'cap-b', runId: 'run-b' })),
      ]);

      expect([first.status, second.status].sort()).toEqual(['blocked', 'reserved']);
      expect(await manager.activeSlots('root-concept')).toHaveLength(1);
    } finally {
      await relativeLedger.close();
    }
  });

  it('release before commit frees the slot for another capability', async () => {
    await manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a' }));
    await expect(manager.release(slotRequest({ capabilityFingerprint: 'cap-a', reason: 'abandoned before forge' }))).resolves.toMatchObject({
      status: 'released',
    });
    await expect(manager.reserve(slotRequest({ capabilityFingerprint: 'cap-b' }))).resolves.toMatchObject({
      status: 'reserved',
      activeSlotCount: 1,
    });
    expect((await manager.activeSlots('root-concept')).map((event) => event.capability_fingerprint)).toEqual(['cap-b']);
  });

  it('commit makes a slot non-releasable', async () => {
    await manager.reserve(slotRequest({ capabilityFingerprint: 'cap-a' }));
    await expect(manager.commit(slotRequest({ capabilityFingerprint: 'cap-a' }))).resolves.toMatchObject({
      status: 'committed',
    });
    await expect(manager.release(slotRequest({ capabilityFingerprint: 'cap-a' }))).resolves.toMatchObject({
      status: 'blocked',
      reason: 'committed tool slots cannot be released',
    });
    expect((await manager.activeSlots('root-concept')).map((event) => event.type)).toEqual(['tool.slot.committed']);
  });

  it('computes deterministic capability fingerprints independent of object key order', () => {
    const a = capabilityFingerprint({ name: 'tool', effects: ['fs.read'], schema: { b: 2, a: 1 } });
    const b = capabilityFingerprint({ schema: { a: 1, b: 2 }, effects: ['fs.read'], name: 'tool' });

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes undefined object properties when computing capability fingerprints', () => {
    const omitted = capabilityFingerprint({ name: 'tool', schema: { type: 'object' } });
    const explicitUndefined = capabilityFingerprint({ name: 'tool', schema: { type: 'object' }, egressAllowlist: undefined });

    expect(explicitUndefined).toBe(omitted);
  });
});

function slotRequest(overrides: Partial<Parameters<ToolSlotManager['reserve']>[0]> = {}): Parameters<ToolSlotManager['reserve']>[0] {
  return {
    runId: 'run-1',
    parentConceptId: 'root-concept',
    capabilityFingerprint: 'cap-a',
    toolName: 'example-tool',
    nodeId: 'node-tool-forge',
    ...overrides,
  };
}
