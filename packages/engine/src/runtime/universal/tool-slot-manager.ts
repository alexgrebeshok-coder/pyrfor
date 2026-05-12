import { createHash } from 'node:crypto';
import type { EventLedger, LedgerEvent, ToolSlotEvent } from '../event-ledger';

export interface ToolSlotManagerOptions {
  softCap?: number;
  hardCap?: number;
}

export interface ToolSlotRequest {
  runId: string;
  parentConceptId: string;
  capabilityFingerprint: string;
  toolName?: string;
  nodeId?: string;
  approvalId?: string;
  reason?: string;
}

export interface ToolSlotDecision {
  status: 'reserved' | 'duplicate' | 'blocked';
  reason: string;
  activeSlotCount: number;
  event?: ToolSlotEvent;
}

export interface ToolSlotMutation {
  status: 'committed' | 'released' | 'missing' | 'blocked';
  reason: string;
  event?: ToolSlotEvent;
}

type SlotStatus = 'reserved' | 'committed';

interface SlotState {
  status: SlotStatus;
  event: ToolSlotEvent;
}

export class ToolSlotManager {
  private static readonly processLineageLocks = new Map<string, Promise<void>>();

  private readonly softCap: number;
  private readonly hardCap: number;

  constructor(private readonly ledger: EventLedger, options: ToolSlotManagerOptions = {}) {
    this.softCap = options.softCap ?? 2;
    this.hardCap = options.hardCap ?? 3;
    if (!Number.isInteger(this.softCap) || this.softCap < 0) {
      throw new ToolSlotError('softCap must be a non-negative integer');
    }
    if (!Number.isInteger(this.hardCap) || this.hardCap < 1 || this.hardCap < this.softCap) {
      throw new ToolSlotError('hardCap must be an integer >= 1 and >= softCap');
    }
  }

  async reserve(request: ToolSlotRequest): Promise<ToolSlotDecision> {
    validateSlotRequest(request);
    return this.withLineageLock(request.parentConceptId, async () => {
      const slots = await this.readLineageSlots(request.parentConceptId);
      const existing = slots.get(request.capabilityFingerprint);
      if (existing) {
        return {
          status: 'duplicate',
          reason: 'capability fingerprint already has an active slot',
          activeSlotCount: slots.size,
          event: existing.event,
        };
      }

      if (slots.size >= this.hardCap) {
        return {
          status: 'blocked',
          reason: 'hard tool slot cap exhausted',
          activeSlotCount: slots.size,
        };
      }
      if (slots.size >= this.softCap && !request.approvalId) {
        return {
          status: 'blocked',
          reason: 'soft tool slot cap requires approval',
          activeSlotCount: slots.size,
        };
      }

      const event = await this.appendToolSlotEvent('tool.slot.reserved', request);
      return {
        status: 'reserved',
        reason: 'tool slot reserved',
        activeSlotCount: slots.size + 1,
        event,
      };
    });
  }

  async commit(request: ToolSlotRequest): Promise<ToolSlotMutation> {
    validateSlotRequest(request);
    return this.withLineageLock(request.parentConceptId, async () => {
      const slots = await this.readLineageSlots(request.parentConceptId);
      const existing = slots.get(request.capabilityFingerprint);
      if (!existing) {
        return { status: 'missing', reason: 'cannot commit a missing slot' };
      }
      if (existing.status === 'committed') {
        return { status: 'committed', reason: 'tool slot already committed', event: existing.event };
      }
      const event = await this.appendToolSlotEvent('tool.slot.committed', request);
      return { status: 'committed', reason: 'tool slot committed', event };
    });
  }

  async release(request: ToolSlotRequest): Promise<ToolSlotMutation> {
    validateSlotRequest(request);
    return this.withLineageLock(request.parentConceptId, async () => {
      const slots = await this.readLineageSlots(request.parentConceptId);
      const existing = slots.get(request.capabilityFingerprint);
      if (!existing) {
        return { status: 'missing', reason: 'cannot release a missing slot' };
      }
      if (existing.status === 'committed') {
        return { status: 'blocked', reason: 'committed tool slots cannot be released' };
      }
      const event = await this.appendToolSlotEvent('tool.slot.released', request);
      return { status: 'released', reason: 'tool slot released', event };
    });
  }

  async activeSlots(parentConceptId: string): Promise<ToolSlotEvent[]> {
    if (!parentConceptId.trim()) throw new ToolSlotError('parentConceptId is required');
    return [...(await this.readLineageSlots(parentConceptId)).values()].map((slot) => slot.event);
  }

  private async readLineageSlots(parentConceptId: string): Promise<Map<string, SlotState>> {
    const slots = new Map<string, SlotState>();
    for (const event of await this.ledger.readAll()) {
      if (!isToolSlotEvent(event) || event.parent_concept_id !== parentConceptId) continue;
      if (event.type === 'tool.slot.released') {
        slots.delete(event.capability_fingerprint);
        continue;
      }
      slots.set(event.capability_fingerprint, {
        status: event.type === 'tool.slot.committed' ? 'committed' : 'reserved',
        event,
      });
    }
    return slots;
  }

  private async appendToolSlotEvent(type: ToolSlotEvent['type'], request: ToolSlotRequest): Promise<ToolSlotEvent> {
    const event = await this.ledger.append({
      type,
      run_id: request.runId,
      parent_concept_id: request.parentConceptId,
      capability_fingerprint: request.capabilityFingerprint,
      tool_name: request.toolName,
      node_id: request.nodeId,
      approval_id: request.approvalId,
      reason: request.reason,
    });
    return event as ToolSlotEvent;
  }

  private async withLineageLock<T>(parentConceptId: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = `${this.ledger.storagePath}\u0000${parentConceptId}`;
    const previous = ToolSlotManager.processLineageLocks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current, () => current);
    ToolSlotManager.processLineageLocks.set(lockKey, chained);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (ToolSlotManager.processLineageLocks.get(lockKey) === chained) {
        ToolSlotManager.processLineageLocks.delete(lockKey);
      }
    }
  }
}

export class ToolSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolSlotError';
  }
}

export function capabilityFingerprint(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function validateSlotRequest(request: ToolSlotRequest): void {
  if (!request.runId.trim()) throw new ToolSlotError('runId is required');
  if (!request.parentConceptId.trim()) throw new ToolSlotError('parentConceptId is required');
  if (!request.capabilityFingerprint.trim()) throw new ToolSlotError('capabilityFingerprint is required');
}

function isToolSlotEvent(event: LedgerEvent): event is ToolSlotEvent {
  return event.type === 'tool.slot.reserved' || event.type === 'tool.slot.committed' || event.type === 'tool.slot.released';
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
