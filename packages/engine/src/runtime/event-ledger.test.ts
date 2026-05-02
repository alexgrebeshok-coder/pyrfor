// @vitest-environment node
/**
 * event-ledger.test.ts — unit tests for EventLedger and helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  EventLedger,
  parseLine,
  makeEvent,
  type LedgerEvent,
} from './event-ledger';

// ====== Helpers ==============================================================

function tmpPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `event-ledger-test-${hex}`, 'ledger.jsonl');
}

function baseEvent(run_id = 'run-abc'): Omit<LedgerEvent, 'ts' | 'seq' | 'id'> {
  return { type: 'run.created', run_id, goal: 'test goal' };
}

// ====== Tests ================================================================

describe('EventLedger', () => {
  let filePath: string;
  let ledger: EventLedger;

  beforeEach(() => {
    filePath = tmpPath();
    ledger = new EventLedger(filePath);
  });

  afterEach(async () => {
    await ledger.close();
    try {
      await rm(path.dirname(filePath), { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  // ── File creation ─────────────────────────────────────────────────────────

  it('creates file and parent directory if missing', async () => {
    const event = await ledger.append(baseEvent());
    expect(event.id).toBeTruthy();
    const all = await ledger.readAll();
    expect(all).toHaveLength(1);
  });

  // ── append + readAll round-trip ───────────────────────────────────────────

  it('round-trips a single event preserving all fields', async () => {
    const returned = await ledger.append({ type: 'run.created', run_id: 'r1', goal: 'hello' });
    const [read] = await ledger.readAll();
    expect(read).toEqual(returned);
    expect(read.type).toBe('run.created');
    expect(read.run_id).toBe('r1');
  });

  it('preserves insertion order across multiple appends', async () => {
    const types: LedgerEvent['type'][] = [
      'run.created',
      'plan.proposed',
      'model.turn.started',
      'model.turn.completed',
      'verifier.waived',
      'run.completed',
    ];
    for (const type of types) {
      await ledger.append({ type, run_id: 'r1' } as Omit<LedgerEvent, 'ts' | 'seq' | 'id'>);
    }
    const all = await ledger.readAll();
    expect(all.map((e) => e.type)).toEqual(types);
  });

  // ── monotonic seq ─────────────────────────────────────────────────────────

  it('assigns monotonically increasing seq starting at 0', async () => {
    const a = await ledger.append(baseEvent());
    const b = await ledger.append(baseEvent());
    const c = await ledger.append(baseEvent());
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(c.seq).toBe(2);
  });

  it('continues seq from existing file on new instance', async () => {
    await ledger.append(baseEvent());
    await ledger.append(baseEvent());

    const ledger2 = new EventLedger(filePath);
    const e = await ledger2.append(baseEvent());
    expect(e.seq).toBe(2);
    await ledger2.close();
  });

  // ── ts field ──────────────────────────────────────────────────────────────

  it('ts is a valid ISO 8601 string', async () => {
    const event = await ledger.append(baseEvent());
    expect(() => new Date(event.ts)).not.toThrow();
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });

  // ── id field ──────────────────────────────────────────────────────────────

  it('each event gets a unique uuid id', async () => {
    const a = await ledger.append(baseEvent());
    const b = await ledger.append(baseEvent());
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  // ── readStream ────────────────────────────────────────────────────────────

  it('readStream yields events incrementally in order', async () => {
    for (let i = 0; i < 5; i++) {
      await ledger.append({ type: 'tool.executed', run_id: 'r1', tool: `t${i}` });
    }
    const streamed: LedgerEvent[] = [];
    for await (const event of ledger.readStream()) {
      streamed.push(event);
    }
    expect(streamed).toHaveLength(5);
    expect(streamed[0].seq).toBe(0);
    expect(streamed[4].seq).toBe(4);
  });

  it('readStream returns nothing for non-existent file', async () => {
    const empty: LedgerEvent[] = [];
    for await (const e of ledger.readStream()) {
      empty.push(e);
    }
    expect(empty).toHaveLength(0);
  });

  // ── byRun + lastEventForRun ───────────────────────────────────────────────

  it('byRun returns only events for the specified run', async () => {
    await ledger.append({ type: 'run.created', run_id: 'run-1' });
    await ledger.append({ type: 'run.created', run_id: 'run-2' });
    await ledger.append({ type: 'run.completed', run_id: 'run-1' });

    const run1 = await ledger.byRun('run-1');
    expect(run1).toHaveLength(2);
    expect(run1.every((e) => e.run_id === 'run-1')).toBe(true);
  });

  it('lastEventForRun returns the last event in append order', async () => {
    await ledger.append({ type: 'run.created', run_id: 'r1' });
    await ledger.append({ type: 'plan.proposed', run_id: 'r1', plan: 'step 1' });
    await ledger.append({ type: 'run.completed', run_id: 'r1' });

    const last = await ledger.lastEventForRun('r1');
    expect(last?.type).toBe('run.completed');
  });

  it('lastEventForRun returns undefined for unknown run', async () => {
    const result = await ledger.lastEventForRun('nonexistent');
    expect(result).toBeUndefined();
  });

  // ── corrupt / malformed lines ─────────────────────────────────────────────

  it('skips malformed lines and still returns valid events', async () => {
    const { appendFile } = await import('node:fs/promises');
    const { mkdir: mkdirFn } = await import('node:fs/promises');

    await mkdirFn(path.dirname(filePath), { recursive: true });
    // Seed: valid, corrupt, valid
    await appendFile(filePath, '{"type":"run.created","run_id":"r1","id":"a","ts":"2024-01-01T00:00:00.000Z","seq":0}\n');
    await appendFile(filePath, 'NOT_JSON_AT_ALL\n');
    await appendFile(filePath, '{"type":"run.completed","run_id":"r1","id":"b","ts":"2024-01-01T00:01:00.000Z","seq":1}\n');

    const all = await ledger.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].type).toBe('run.created');
    expect(all[1].type).toBe('run.completed');
  });

  // ── parallel appends ──────────────────────────────────────────────────────

  it('20 parallel appends produce exactly 20 events', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ledger.append({ type: 'tool.executed', run_id: 'r-parallel', tool: `tool-${i}` }),
      ),
    );
    const all = await ledger.readAll();
    expect(all).toHaveLength(20);
  });

  // ── filter ────────────────────────────────────────────────────────────────

  it('filter returns only matching events', async () => {
    await ledger.append({ type: 'run.created', run_id: 'r1' });
    await ledger.append({ type: 'run.failed', run_id: 'r2', error: 'boom' });
    await ledger.append({ type: 'run.completed', run_id: 'r1' });

    const failed = await ledger.filter((e) => e.type === 'run.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].run_id).toBe('r2');
  });

  // ── fsync option ──────────────────────────────────────────────────────────

  it('works with fsync:true option', async () => {
    const syncLedger = new EventLedger(filePath, { fsync: true });
    const e = await syncLedger.append(baseEvent());
    expect(e.seq).toBe(0);
    await syncLedger.close();
    const all = await ledger.readAll();
    expect(all).toHaveLength(1);
  });

  // ── close is idempotent ───────────────────────────────────────────────────

  it('close can be called multiple times without error', async () => {
    await expect(ledger.close()).resolves.not.toThrow();
    await expect(ledger.close()).resolves.not.toThrow();
  });
});

// ====== parseLine ============================================================

describe('parseLine', () => {
  it('parses a valid JSONL line', () => {
    const obj = { type: 'run.created', run_id: 'r1', id: 'x', ts: new Date().toISOString(), seq: 0 };
    const result = parseLine(JSON.stringify(obj));
    expect(result).toEqual(obj);
  });

  it('returns null for empty/whitespace line', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseLine('{bad json')).toBeNull();
  });
});

// ====== makeEvent ============================================================

describe('makeEvent', () => {
  it('assigns uuid id', () => {
    const e = makeEvent({ type: 'run.created', run_id: 'r1' });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('assigns ISO ts', () => {
    const e = makeEvent({ type: 'run.created', run_id: 'r1' });
    expect(new Date(e.ts).toISOString()).toBe(e.ts);
  });

  it('defaults seq to 0', () => {
    const e = makeEvent({ type: 'run.created', run_id: 'r1' });
    expect(e.seq).toBe(0);
  });

  it('honours explicit seq', () => {
    const e = makeEvent({ type: 'run.created', run_id: 'r1', seq: 42 });
    expect(e.seq).toBe(42);
  });
});
