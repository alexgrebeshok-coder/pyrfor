// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import {
  createSessionRecorder,
  createSessionReplayer,
  type ReplayEvent,
} from './session-replay';

// ── Temp-dir helpers ───────────────────────────────────────────────────────

const TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__session_replay_test_tmp__',
);

const cleanupDirs: string[] = [];

async function makeTestDir(label: string): Promise<string> {
  await fsp.mkdir(TMP_BASE, { recursive: true });
  const dir = path.join(
    TMP_BASE,
    label + '-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  );
  await fsp.mkdir(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of cleanupDirs.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true });
  }
});

// ── Utilities ──────────────────────────────────────────────────────────────

function readLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function readEvents(filePath: string): ReplayEvent[] {
  return readLines(filePath).map((l) => JSON.parse(l));
}

function makeClock(start = 1000): { tick: (n?: number) => void; clock: () => number } {
  let now = start;
  return {
    tick: (n = 100) => { now += n; },
    clock: () => now,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// RECORDER tests
// ══════════════════════════════════════════════════════════════════════════

describe('createSessionRecorder', () => {
  it('record() appends event with correct ts from injected clock', async () => {
    const storeDir = await makeTestDir('ts');
    const { clock, tick } = makeClock(5000);
    const r = createSessionRecorder({ storeDir, sessionId: 'ts-test', clock });

    r.record('userMessage', { text: 'hello' });
    tick(50);
    r.record('assistantMessage', { text: 'world' });
    await r.flush();

    const events = readEvents(path.join(storeDir, 'ts-test.jsonl'));
    expect(events[0].ts).toBe(5000);
    expect(events[1].ts).toBe(5050);
  });

  it('record() attaches the correct sessionId', async () => {
    const storeDir = await makeTestDir('sid');
    const r = createSessionRecorder({ storeDir, sessionId: 'my-session' });
    r.record('meta', {});
    await r.flush();

    const events = readEvents(path.join(storeDir, 'my-session.jsonl'));
    expect(events[0].sessionId).toBe('my-session');
  });

  it('record() stores the correct kind', async () => {
    const storeDir = await makeTestDir('kind');
    const r = createSessionRecorder({ storeDir, sessionId: 'kind-test' });
    r.record('toolCallStart', { tool: 'search' });
    await r.flush();

    const [evt] = readEvents(path.join(storeDir, 'kind-test.jsonl'));
    expect(evt.kind).toBe('toolCallStart');
  });

  it('record() stores the correct payload', async () => {
    const storeDir = await makeTestDir('payload');
    const r = createSessionRecorder({ storeDir, sessionId: 'p-test' });
    r.record('userMessage', { text: 'hi', tokens: 3 });
    await r.flush();

    const [evt] = readEvents(path.join(storeDir, 'p-test.jsonl'));
    expect(evt.payload).toEqual({ text: 'hi', tokens: 3 });
  });

  it('record() defaults payload to {} when undefined', async () => {
    const storeDir = await makeTestDir('null-payload');
    const r = createSessionRecorder({ storeDir, sessionId: 'np' });
    r.record('meta', undefined as any);
    await r.flush();

    const [evt] = readEvents(path.join(storeDir, 'np.jsonl'));
    expect(evt.payload).toEqual({});
  });

  it('flush() writes buffered events to file', async () => {
    const storeDir = await makeTestDir('flush');
    const r = createSessionRecorder({ storeDir, sessionId: 'flush-test', flushDebounceMs: 9999 });
    r.record('userMessage', { n: 1 });
    r.record('assistantMessage', { n: 2 });

    expect(existsSync(path.join(storeDir, 'flush-test.jsonl'))).toBe(false);
    await r.flush();

    const lines = readLines(path.join(storeDir, 'flush-test.jsonl'));
    expect(lines).toHaveLength(2);
  });

  it('flush() creates storeDir if it does not exist', async () => {
    const storeDir = await makeTestDir('nodir');
    const nested = path.join(storeDir, 'deep', 'nested');
    const r = createSessionRecorder({ storeDir: nested, sessionId: 's1', flushDebounceMs: 9999 });
    r.record('meta', { x: 1 });
    await r.flush();

    expect(existsSync(path.join(nested, 's1.jsonl'))).toBe(true);
  });

  it('flush() is a no-op (no file created) when buffer is empty', async () => {
    const storeDir = await makeTestDir('empty-flush');
    const r = createSessionRecorder({ storeDir, sessionId: 'ef' });
    await r.flush();
    expect(existsSync(path.join(storeDir, 'ef.jsonl'))).toBe(false);
  });

  it('flushEveryNEvents triggers automatic flush', async () => {
    const storeDir = await makeTestDir('auto-flush');
    const r = createSessionRecorder({
      storeDir,
      sessionId: 'af',
      flushEveryNEvents: 3,
      flushDebounceMs: 99999,
    });

    r.record('meta', { n: 1 });
    r.record('meta', { n: 2 });
    r.record('meta', { n: 3 }); // triggers auto-flush

    // await flush() to ensure the in-flight write has completed
    await r.flush();

    const lines = readLines(path.join(storeDir, 'af.jsonl'));
    expect(lines).toHaveLength(3);
  });

  it('debounce timer triggers flush after flushDebounceMs', async () => {
    vi.useFakeTimers();
    const storeDir = await makeTestDir('debounce');
    try {
      const r = createSessionRecorder({
        storeDir,
        sessionId: 'deb',
        flushEveryNEvents: 100,
        flushDebounceMs: 200,
      });

      r.record('meta', { x: 1 });
      expect(existsSync(path.join(storeDir, 'deb.jsonl'))).toBe(false);

      await vi.advanceTimersByTimeAsync(200);
      // Await the in-flight appendFile that the debounce callback triggered.
      await r.flush();

      const lines = readLines(path.join(storeDir, 'deb.jsonl'));
      expect(lines).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() emits sessionEnd as last event', async () => {
    const storeDir = await makeTestDir('close-end');
    const r = createSessionRecorder({ storeDir, sessionId: 'ce', flushDebounceMs: 9999 });
    r.record('userMessage', { text: 'hi' });
    await r.close();

    const events = readEvents(path.join(storeDir, 'ce.jsonl'));
    expect(events[events.length - 1].kind).toBe('sessionEnd');
  });

  it('close() flushes all buffered events', async () => {
    const storeDir = await makeTestDir('close-flush');
    const r = createSessionRecorder({ storeDir, sessionId: 'cf', flushDebounceMs: 9999 });
    r.record('meta', { a: 1 });
    r.record('meta', { a: 2 });
    await r.close();

    // 2 meta + 1 sessionEnd
    const events = readEvents(path.join(storeDir, 'cf.jsonl'));
    expect(events).toHaveLength(3);
  });

  it('close() prevents further record() calls', async () => {
    const storeDir = await makeTestDir('close-noop');
    const r = createSessionRecorder({ storeDir, sessionId: 'cn', flushDebounceMs: 9999 });
    await r.close();
    r.record('meta', { after: true }); // should be ignored
    await r.flush();

    const events = readEvents(path.join(storeDir, 'cn.jsonl'));
    // only the auto-emitted sessionEnd from close()
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('sessionEnd');
  });

  it('close() is idempotent — second call is a no-op', async () => {
    const storeDir = await makeTestDir('close-idem');
    const r = createSessionRecorder({ storeDir, sessionId: 'ci', flushDebounceMs: 9999 });
    r.record('meta', {});
    await r.close();
    await r.close(); // second close — must not emit another sessionEnd

    const events = readEvents(path.join(storeDir, 'ci.jsonl'));
    const ends = events.filter((e) => e.kind === 'sessionEnd');
    expect(ends).toHaveLength(1);
  });

  it('count() reflects buffered + flushed events', async () => {
    const storeDir = await makeTestDir('count');
    const r = createSessionRecorder({
      storeDir,
      sessionId: 'cnt',
      flushEveryNEvents: 5,
      flushDebounceMs: 9999,
    });

    expect(r.count()).toBe(0);
    r.record('meta', { n: 1 });
    r.record('meta', { n: 2 });
    expect(r.count()).toBe(2); // both buffered

    await r.flush();
    expect(r.count()).toBe(2); // moved to flushed

    r.record('meta', { n: 3 });
    expect(r.count()).toBe(3); // 2 flushed + 1 buffered
  });

  it('meta() helper records a meta kind event', async () => {
    const storeDir = await makeTestDir('meta');
    const r = createSessionRecorder({ storeDir, sessionId: 'meta-h', flushDebounceMs: 9999 });
    r.meta({ info: 'build-1.0' });
    await r.flush();

    const [evt] = readEvents(path.join(storeDir, 'meta-h.jsonl'));
    expect(evt.kind).toBe('meta');
    expect(evt.payload).toEqual({ info: 'build-1.0' });
  });

  it('sessionStart() helper records a sessionStart event', async () => {
    const storeDir = await makeTestDir('sstart');
    const r = createSessionRecorder({ storeDir, sessionId: 'ss', flushDebounceMs: 9999 });
    r.sessionStart({ userId: 'u1' });
    await r.flush();

    const [evt] = readEvents(path.join(storeDir, 'ss.jsonl'));
    expect(evt.kind).toBe('sessionStart');
  });

  it('sessionEnd() helper records a sessionEnd event', async () => {
    const storeDir = await makeTestDir('send');
    const r = createSessionRecorder({ storeDir, sessionId: 'se', flushDebounceMs: 9999 });
    r.sessionEnd({ reason: 'timeout' });
    await r.flush();

    const [evt] = readEvents(path.join(storeDir, 'se.jsonl'));
    expect(evt.kind).toBe('sessionEnd');
  });

  it('multiple flush() calls append correctly (cumulative writes)', async () => {
    const storeDir = await makeTestDir('multi-flush');
    const r = createSessionRecorder({ storeDir, sessionId: 'mf', flushDebounceMs: 9999 });

    r.record('userMessage', { n: 1 });
    await r.flush();
    r.record('assistantMessage', { n: 2 });
    await r.flush();

    const events = readEvents(path.join(storeDir, 'mf.jsonl'));
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('userMessage');
    expect(events[1].kind).toBe('assistantMessage');
  });

  it('ts values use injected clock and reflect call order (monotonic)', async () => {
    const storeDir = await makeTestDir('mono');
    let now = 0;
    const clock = () => ++now * 10;
    const r = createSessionRecorder({ storeDir, sessionId: 'mono', clock, flushDebounceMs: 9999 });

    for (let i = 0; i < 4; i++) r.record('meta', { i });
    await r.flush();

    const events = readEvents(path.join(storeDir, 'mono.jsonl'));
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ts).toBeGreaterThan(events[i - 1].ts);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REPLAYER tests
// ══════════════════════════════════════════════════════════════════════════

describe('createSessionReplayer', () => {
  // Helper: write a session file directly
  async function writeSession(storeDir: string, sessionId: string, events: ReplayEvent[]) {
    await fsp.mkdir(storeDir, { recursive: true });
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fsp.writeFile(path.join(storeDir, `${sessionId}.jsonl`), lines, 'utf8');
  }

  function makeEvents(sessionId: string, count: number, startTs = 0): ReplayEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      ts: startTs + i * 100,
      sessionId,
      kind: (i % 2 === 0 ? 'userMessage' : 'assistantMessage') as ReplayEvent['kind'],
      payload: { idx: i },
    }));
  }

  it('listSessions() returns empty array when storeDir is missing', async () => {
    const storeDir = await makeTestDir('ls-empty');
    const r = createSessionReplayer({ storeDir: path.join(storeDir, 'nonexistent') });
    expect(r.listSessions()).toEqual([]);
  });

  it('listSessions() returns empty array when storeDir has no .jsonl files', async () => {
    const storeDir = await makeTestDir('ls-no-jsonl');
    await fsp.writeFile(path.join(storeDir, 'notes.txt'), 'hello');
    const r = createSessionReplayer({ storeDir });
    expect(r.listSessions()).toEqual([]);
  });

  it('listSessions() discovers .jsonl files', async () => {
    const storeDir = await makeTestDir('ls-discover');
    await writeSession(storeDir, 'abc', makeEvents('abc', 3));
    await writeSession(storeDir, 'def', makeEvents('def', 5));
    const r = createSessionReplayer({ storeDir });
    const ids = r.listSessions().map((s) => s.sessionId).sort();
    expect(ids).toEqual(['abc', 'def']);
  });

  it('listSessions() returns correct eventCount', async () => {
    const storeDir = await makeTestDir('ls-count');
    await writeSession(storeDir, 's1', makeEvents('s1', 7));
    const r = createSessionReplayer({ storeDir });
    const [s] = r.listSessions();
    expect(s.eventCount).toBe(7);
  });

  it('listSessions() returns correct firstTs and lastTs', async () => {
    const storeDir = await makeTestDir('ls-ts');
    const events = makeEvents('ts-sess', 4, 1000);
    await writeSession(storeDir, 'ts-sess', events);
    const r = createSessionReplayer({ storeDir });
    const [s] = r.listSessions();
    expect(s.firstTs).toBe(1000);
    expect(s.lastTs).toBe(1300);
  });

  it('loadSession() returns events in order', async () => {
    const storeDir = await makeTestDir('load-order');
    const events = makeEvents('lo', 5);
    await writeSession(storeDir, 'lo', events);
    const r = createSessionReplayer({ storeDir });
    const loaded = r.loadSession('lo');
    expect(loaded).toHaveLength(5);
    expect(loaded.map((e) => e.payload.idx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('loadSession() returns empty array for missing file', async () => {
    const storeDir = await makeTestDir('load-missing');
    const r = createSessionReplayer({ storeDir });
    expect(r.loadSession('ghost')).toEqual([]);
  });

  it('corrupt JSONL line is skipped while the rest are loaded', async () => {
    const storeDir = await makeTestDir('corrupt');
    const good1 = JSON.stringify({ ts: 1, sessionId: 'c', kind: 'meta', payload: { n: 1 } });
    const bad = 'NOT_JSON{{{';
    const good2 = JSON.stringify({ ts: 2, sessionId: 'c', kind: 'meta', payload: { n: 2 } });
    await fsp.writeFile(path.join(storeDir, 'c.jsonl'), [good1, bad, good2, ''].join('\n'));

    const r = createSessionReplayer({ storeDir });
    const events = r.loadSession('c');
    expect(events).toHaveLength(2);
    expect(events[0].payload.n).toBe(1);
    expect(events[1].payload.n).toBe(2);
  });

  it('corrupt JSONL line triggers a console.warn', async () => {
    const storeDir = await makeTestDir('corrupt-warn');
    const bad = 'BAD_JSON';
    const good = JSON.stringify({ ts: 1, sessionId: 'cw', kind: 'meta', payload: {} });
    await fsp.writeFile(path.join(storeDir, 'cw.jsonl'), [bad, good, ''].join('\n'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = createSessionReplayer({ storeDir });
    r.loadSession('cw');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('iterate at speed=0 yields all events without waiting', async () => {
    const storeDir = await makeTestDir('iter-speed0');
    const events = makeEvents('sp0', 5, 0);
    await writeSession(storeDir, 'sp0', events);

    const r = createSessionReplayer({ storeDir });
    const received: ReplayEvent[] = [];
    for await (const e of r.iterate('sp0', { speed: 0 })) {
      received.push(e);
    }
    expect(received).toHaveLength(5);
    expect(received.map((e) => e.payload.idx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('iterate at speed=1 respects gaps between events', async () => {
    vi.useFakeTimers();
    const storeDir = await makeTestDir('iter-speed1');
    try {
      const events: ReplayEvent[] = [
        { ts: 0, sessionId: 'sp1', kind: 'userMessage', payload: { n: 0 } },
        { ts: 100, sessionId: 'sp1', kind: 'assistantMessage', payload: { n: 1 } },
        { ts: 300, sessionId: 'sp1', kind: 'meta', payload: { n: 2 } },
      ];
      await writeSession(storeDir, 'sp1', events);

      const r = createSessionReplayer({ storeDir });
      const received: ReplayEvent[] = [];

      const consuming = (async () => {
        for await (const e of r.iterate('sp1', { speed: 1 })) {
          received.push(e);
        }
      })();

      // First event: yields immediately (no prior gap)
      await Promise.resolve();
      await Promise.resolve();
      expect(received).toHaveLength(1);

      // Advance 100 ms → second event
      await vi.advanceTimersByTimeAsync(100);
      expect(received).toHaveLength(2);

      // Advance 200 ms → third event
      await vi.advanceTimersByTimeAsync(200);
      expect(received).toHaveLength(3);

      await consuming;
    } finally {
      vi.useRealTimers();
    }
  });

  it('iterate at speed=2 halves the real-time gap', async () => {
    vi.useFakeTimers();
    const storeDir = await makeTestDir('iter-speed2');
    try {
      const events: ReplayEvent[] = [
        { ts: 0, sessionId: 'sp2', kind: 'userMessage', payload: {} },
        { ts: 200, sessionId: 'sp2', kind: 'assistantMessage', payload: {} },
      ];
      await writeSession(storeDir, 'sp2', events);

      const r = createSessionReplayer({ storeDir });
      const received: ReplayEvent[] = [];

      const consuming = (async () => {
        for await (const e of r.iterate('sp2', { speed: 2 })) {
          received.push(e);
        }
      })();

      await Promise.resolve();
      await Promise.resolve();
      expect(received).toHaveLength(1);

      // gap is 200ms, speed=2 → wait 100ms
      await vi.advanceTimersByTimeAsync(100);
      expect(received).toHaveLength(2);

      await consuming;
    } finally {
      vi.useRealTimers();
    }
  });

  it('iterate honors AbortSignal — stops mid-stream', async () => {
    vi.useFakeTimers();
    const storeDir = await makeTestDir('iter-abort');
    try {
      const events: ReplayEvent[] = [
        { ts: 0, sessionId: 'ab', kind: 'userMessage', payload: { n: 0 } },
        { ts: 500, sessionId: 'ab', kind: 'assistantMessage', payload: { n: 1 } },
        { ts: 1000, sessionId: 'ab', kind: 'meta', payload: { n: 2 } },
      ];
      await writeSession(storeDir, 'ab', events);

      const ac = new AbortController();
      const r = createSessionReplayer({ storeDir });
      const received: ReplayEvent[] = [];

      const consuming = (async () => {
        for await (const e of r.iterate('ab', { speed: 1, signal: ac.signal })) {
          received.push(e);
          if (received.length === 1) ac.abort(); // abort after first
        }
      })();

      await Promise.resolve();
      await Promise.resolve();
      // abort fired synchronously inside loop; sleep resolves early
      await vi.advanceTimersByTimeAsync(0);
      await consuming;

      expect(received).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('iterate returns empty iterable for non-existent session', async () => {
    const storeDir = await makeTestDir('iter-empty');
    const r = createSessionReplayer({ storeDir });
    const received: ReplayEvent[] = [];
    for await (const e of r.iterate('ghost')) {
      received.push(e);
    }
    expect(received).toHaveLength(0);
  });

  it('tail() returns the last N events', async () => {
    const storeDir = await makeTestDir('tail');
    await writeSession(storeDir, 't1', makeEvents('t1', 10));
    const r = createSessionReplayer({ storeDir });
    const last3 = r.tail('t1', 3);
    expect(last3).toHaveLength(3);
    expect(last3.map((e) => e.payload.idx)).toEqual([7, 8, 9]);
  });

  it('tail() returns all events if N > total count', async () => {
    const storeDir = await makeTestDir('tail-overflow');
    await writeSession(storeDir, 'to', makeEvents('to', 4));
    const r = createSessionReplayer({ storeDir });
    expect(r.tail('to', 100)).toHaveLength(4);
  });

  it('tail() returns empty array for missing session', async () => {
    const storeDir = await makeTestDir('tail-missing');
    const r = createSessionReplayer({ storeDir });
    expect(r.tail('nobody', 5)).toEqual([]);
  });

  it('filter() by kind keeps only matching events', async () => {
    const storeDir = await makeTestDir('filter-kind');
    const events = makeEvents('fk', 6); // alternating userMessage / assistantMessage
    await writeSession(storeDir, 'fk', events);
    const r = createSessionReplayer({ storeDir });
    const loaded = r.loadSession('fk');
    const users = r.filter(loaded, (e) => e.kind === 'userMessage');
    expect(users).toHaveLength(3);
    expect(users.every((e) => e.kind === 'userMessage')).toBe(true);
  });

  it('filter() by payload field', async () => {
    const storeDir = await makeTestDir('filter-payload');
    const events: ReplayEvent[] = [
      { ts: 1, sessionId: 'fp', kind: 'meta', payload: { tag: 'A' } },
      { ts: 2, sessionId: 'fp', kind: 'meta', payload: { tag: 'B' } },
      { ts: 3, sessionId: 'fp', kind: 'meta', payload: { tag: 'A' } },
    ];
    await writeSession(storeDir, 'fp', events);
    const r = createSessionReplayer({ storeDir });
    const loaded = r.loadSession('fp');
    const tagged = r.filter(loaded, (e) => e.payload['tag'] === 'A');
    expect(tagged).toHaveLength(2);
  });

  it('filter() returns empty array when nothing matches', async () => {
    const storeDir = await makeTestDir('filter-empty');
    const events = makeEvents('fe', 3);
    await writeSession(storeDir, 'fe', events);
    const r = createSessionReplayer({ storeDir });
    const loaded = r.loadSession('fe');
    expect(r.filter(loaded, (e) => e.kind === 'error')).toEqual([]);
  });

  it('exportJson() returns a JSON string that round-trips to the original events', async () => {
    const storeDir = await makeTestDir('export');
    const events = makeEvents('ej', 4);
    await writeSession(storeDir, 'ej', events);
    const r = createSessionReplayer({ storeDir });
    const json = r.exportJson('ej');
    const parsed: ReplayEvent[] = JSON.parse(json);
    expect(parsed).toHaveLength(4);
    expect(parsed).toEqual(events);
  });

  it('exportJson() produces a valid JSON array', async () => {
    const storeDir = await makeTestDir('export-array');
    await writeSession(storeDir, 'ea', makeEvents('ea', 2));
    const r = createSessionReplayer({ storeDir });
    const json = r.exportJson('ea');
    expect(() => JSON.parse(json)).not.toThrow();
    expect(Array.isArray(JSON.parse(json))).toBe(true);
  });

  it('exportJson() returns "[]" for missing session', async () => {
    const storeDir = await makeTestDir('export-missing');
    const r = createSessionReplayer({ storeDir });
    expect(r.exportJson('ghost')).toBe('[]');
  });

  it('round-trip: recorder writes → replayer reads back identical events', async () => {
    const storeDir = await makeTestDir('roundtrip');
    let ts = 0;
    const clock = () => (ts += 10);
    const rec = createSessionRecorder({ storeDir, sessionId: 'rt', clock, flushDebounceMs: 9999 });

    rec.sessionStart({ userId: 'u1' });
    rec.record('userMessage', { text: 'ping' });
    rec.record('toolCallStart', { tool: 'search', args: { q: 'x' } });
    rec.record('toolCallEnd', { tool: 'search', result: [] });
    rec.record('assistantMessage', { text: 'pong' });
    await rec.close();

    const rep = createSessionReplayer({ storeDir });
    const events = rep.loadSession('rt');
    // sessionStart + userMessage + toolCallStart + toolCallEnd + assistantMessage + sessionEnd(from close)
    expect(events).toHaveLength(6);
    expect(events[0].kind).toBe('sessionStart');
    expect(events[5].kind).toBe('sessionEnd');
  });
});
