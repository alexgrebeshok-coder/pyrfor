/**
 * event-ledger.ts — Append-only JSONL event ledger for Pyrfor run auditing.
 *
 * Features:
 * - Discriminated-union LedgerEvent covering the full run lifecycle
 * - Atomic appends (open 'a', write line, optional fsync)
 * - Crash-safe: never overwrites existing lines; corrupt lines skipped with warn
 * - Line-by-line streaming via readline for memory-efficient reads
 * - Monotonic seq counter seeded from on-disk line count at first open
 */

import { open, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import * as nodeCrypto from 'node:crypto';
import path from 'node:path';
import logger from '../observability/logger';

// ====== Event type union =====================================================

export type LedgerEventType =
  | 'run.created'
  | 'plan.proposed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'model.turn.started'
  | 'model.turn.completed'
  | 'tool.requested'
  | 'tool.approved'
  | 'tool.denied'
  | 'tool.executed'
  | 'artifact.created'
  | 'diff.proposed'
  | 'diff.applied'
  | 'test.completed'
  | 'run.blocked'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

// ─── Base fields present on every event ─────────────────────────────────────

interface EventBase {
  /** UUID v4 */
  id: string;
  /** ISO 8601 timestamp */
  ts: string;
  /** Owning run identifier */
  run_id: string;
  /** Monotonically increasing per-ledger sequence number (0-based) */
  seq: number;
}

// ─── Per-type discriminated shapes ──────────────────────────────────────────

export interface RunCreatedEvent extends EventBase {
  type: 'run.created';
  goal?: string;
  provider?: string;
  model?: string;
}

export interface PlanProposedEvent extends EventBase {
  type: 'plan.proposed';
  plan?: string;
  steps?: number;
}

export interface ApprovalRequestedEvent extends EventBase {
  type: 'approval.requested';
  reason?: string;
  tool?: string;
}

export interface ApprovalGrantedEvent extends EventBase {
  type: 'approval.granted';
  approved_by?: string;
  tool?: string;
}

export interface ApprovalDeniedEvent extends EventBase {
  type: 'approval.denied';
  approved_by?: string;
  reason?: string;
  tool?: string;
}

export interface ModelTurnStartedEvent extends EventBase {
  type: 'model.turn.started';
  model?: string;
  provider?: string;
  turn?: number;
}

export interface ModelTurnCompletedEvent extends EventBase {
  type: 'model.turn.completed';
  model?: string;
  provider?: string;
  turn?: number;
  ms?: number;
  tokens?: number;
}

export interface ToolRequestedEvent extends EventBase {
  type: 'tool.requested';
  tool?: string;
  args?: Record<string, unknown>;
}

export interface ToolApprovedEvent extends EventBase {
  type: 'tool.approved';
  tool?: string;
  approved_by?: string;
}

export interface ToolDeniedEvent extends EventBase {
  type: 'tool.denied';
  tool?: string;
  reason?: string;
}

export interface ToolExecutedEvent extends EventBase {
  type: 'tool.executed';
  tool?: string;
  ms?: number;
  status?: string;
  error?: string;
}

export interface ArtifactCreatedEvent extends EventBase {
  type: 'artifact.created';
  files?: string[];
  artifact_id?: string;
}

export interface DiffProposedEvent extends EventBase {
  type: 'diff.proposed';
  files?: string[];
  lines_added?: number;
  lines_removed?: number;
}

export interface DiffAppliedEvent extends EventBase {
  type: 'diff.applied';
  files?: string[];
  ms?: number;
}

export interface TestCompletedEvent extends EventBase {
  type: 'test.completed';
  passed?: number;
  failed?: number;
  skipped?: number;
  ms?: number;
  status?: string;
}

export interface RunBlockedEvent extends EventBase {
  type: 'run.blocked';
  reason?: string;
}

export interface RunCompletedEvent extends EventBase {
  type: 'run.completed';
  ms?: number;
  status?: string;
}

export interface RunFailedEvent extends EventBase {
  type: 'run.failed';
  error?: string;
  ms?: number;
}

export interface RunCancelledEvent extends EventBase {
  type: 'run.cancelled';
  reason?: string;
}

export type LedgerEvent =
  | RunCreatedEvent
  | PlanProposedEvent
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | ApprovalDeniedEvent
  | ModelTurnStartedEvent
  | ModelTurnCompletedEvent
  | ToolRequestedEvent
  | ToolApprovedEvent
  | ToolDeniedEvent
  | ToolExecutedEvent
  | ArtifactCreatedEvent
  | DiffProposedEvent
  | DiffAppliedEvent
  | TestCompletedEvent
  | RunBlockedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent;

// ====== Pure functional helpers =============================================

/**
 * Parse a single JSONL line. Returns null (and warns) on corrupt input.
 */
export function parseLine(line: string): LedgerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as LedgerEvent;
  } catch {
    logger.warn(`[EventLedger] Skipping corrupt JSONL line: ${trimmed.slice(0, 120)}`);
    return null;
  }
}

/**
 * Construct a LedgerEvent with auto-generated id and ts; seq defaults to 0.
 * Useful for testing or pre-building events before appending.
 */
export function makeEvent(
  partial: Omit<LedgerEvent, 'id' | 'ts' | 'seq'> & { seq?: number },
): LedgerEvent {
  return {
    id: nodeCrypto.randomUUID(),
    ts: new Date().toISOString(),
    seq: partial.seq ?? 0,
    ...partial,
  } as LedgerEvent;
}

// ====== EventLedger class ====================================================

export interface EventLedgerOptions {
  /** If true, fsync is called after every append for crash durability. */
  fsync?: boolean;
}

export class EventLedger {
  private readonly filePath: string;
  private readonly opts: Required<EventLedgerOptions>;
  /** Monotonic counter — seeded from line count on first append/read. */
  private seq = -1;
  /** Whether seq has been initialised from disk. */
  private seqReady = false;

  constructor(filePath: string, opts: EventLedgerOptions = {}) {
    this.filePath = filePath;
    this.opts = { fsync: false, ...opts };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** Ensure parent directory exists. */
  private async ensureDir(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
  }

  /** Count existing lines to seed the seq counter (called once). */
  private async initSeq(): Promise<void> {
    if (this.seqReady) return;
    let count = 0;
    try {
      for await (const _event of this.readStream()) {
        count++;
      }
    } catch {
      // File doesn't exist yet — count stays 0
    }
    this.seq = count;
    this.seqReady = true;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Append a new event. Auto-fills `id`, `ts`, and `seq`.
   * Uses 'a' flag so existing data is never overwritten.
   */
  async append(event: Omit<LedgerEvent, 'ts' | 'seq' | 'id'>): Promise<LedgerEvent> {
    await this.ensureDir();
    await this.initSeq();

    const full: LedgerEvent = {
      ...event,
      id: nodeCrypto.randomUUID(),
      ts: new Date().toISOString(),
      seq: this.seq++,
    } as LedgerEvent;

    const line = JSON.stringify(full) + '\n';
    const fh = await open(this.filePath, 'a');
    try {
      await fh.write(line);
      if (this.opts.fsync) await fh.datasync();
    } finally {
      await fh.close();
    }

    return full;
  }

  /**
   * Read all events from the ledger file.
   * Corrupt lines are skipped (logged as warn).
   */
  async readAll(): Promise<LedgerEvent[]> {
    const events: LedgerEvent[] = [];
    try {
      for await (const event of this.readStream()) {
        events.push(event);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
    return events;
  }

  /**
   * Stream events line-by-line. Tolerant of a partial last line.
   * Corrupt lines are skipped.
   */
  async *readStream(): AsyncIterable<LedgerEvent> {
    // createReadStream emits errors asynchronously, so we must handle them via
    // the stream's error event before attaching readline.
    const stream = createReadStream(this.filePath, { encoding: 'utf8' });

    // Wrap stream in a promise that resolves once the stream is open (or rejects
    // on ENOENT / other open errors), so we can bail early without leaving
    // dangling handles.
    await new Promise<void>((resolve, reject) => {
      stream.once('ready', () => resolve());
      stream.once('error', (err) => reject(err));
    }).catch((err: NodeJS.ErrnoException) => {
      stream.destroy();
      if (err.code === 'ENOENT') return; // file doesn't exist yet — yield nothing
      throw err;
    });

    if (stream.destroyed) return;

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        const event = parseLine(line);
        if (event) yield event;
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  /**
   * Return all events matching `predicate`.
   */
  async filter(predicate: (e: LedgerEvent) => boolean): Promise<LedgerEvent[]> {
    const all = await this.readAll();
    return all.filter(predicate);
  }

  /**
   * Return all events for a given run_id in append order.
   */
  async byRun(runId: string): Promise<LedgerEvent[]> {
    return this.filter((e) => e.run_id === runId);
  }

  /**
   * Return the most-recently appended event for a given run_id.
   */
  async lastEventForRun(runId: string): Promise<LedgerEvent | undefined> {
    const events = await this.byRun(runId);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  /**
   * No-op for API symmetry; individual appends use short-lived file handles.
   */
  async close(): Promise<void> {
    // Nothing to flush — each append opens/closes its own handle.
  }
}
