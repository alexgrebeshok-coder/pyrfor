/**
 * pyrfor-trajectory-recorder.test.ts
 *
 * Vitest tests for the JSONL trajectory recorder.
 * Uses an in-memory stub TrajectoryFs — never touches real disk.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTrajectoryRecorder } from './pyrfor-trajectory-recorder.js';
import type { TrajectoryFs, TrajectoryRecord } from './pyrfor-trajectory-recorder.js';
import type { FCEvent, FCEnvelope } from './pyrfor-fc-adapter.js';
import type { FcEvent } from './pyrfor-event-reader.js';

// ── Stub filesystem ───────────────────────────────────────────────────────────

interface CallRecord {
  method: string;
  args: unknown[];
  resolveAfterMs?: number;
}

function makeStubFs(opts?: { appendDelay?: (path: string, callIdx: number) => number }) {
  const files = new Map<string, string>();
  const calls: CallRecord[] = [];

  const fs: TrajectoryFs = {
    async mkdir(p, o) {
      calls.push({ method: 'mkdir', args: [p, o] });
    },
    async appendFile(p, data) {
      const delay = opts?.appendDelay?.(p, calls.filter(c => c.method === 'appendFile').length) ?? 0;
      calls.push({ method: 'appendFile', args: [p, data] });
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      files.set(p, (files.get(p) ?? '') + data);
    },
    async readFile(p, _enc) {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    async rename(a, b) {
      calls.push({ method: 'rename', args: [a, b] });
      const content = files.get(a);
      if (content !== undefined) {
        files.set(b, content);
        files.delete(a);
      }
    },
    async stat(p) {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return { size: Buffer.byteLength(content), mtimeMs: Date.now() };
    },
    async readdir(_p) {
      return [...files.keys()].map(k => k.split('/').pop()!);
    },
  };

  return { fs, files, calls };
}

const FIXED_NOW = 1_700_000_000_000;
const DIR = '/fake/trajectories';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createTrajectoryRecorder', () => {
  let stub: ReturnType<typeof makeStubFs>;

  beforeEach(() => {
    stub = makeStubFs();
  });

  // 1. Works with default opts (stub fs prevents real disk access)
  it('creates recorder with default opts using stub fs', () => {
    const rec = createTrajectoryRecorder({ fs: stub.fs, now: () => FIXED_NOW });
    expect(rec).toBeDefined();
    expect(typeof rec.openSession).toBe('function');
  });

  // 2. openSession writes a session_open record with the right shape
  it('openSession writes correct session_open record', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess1', { taskId: 'task-abc', cwd: '/work', model: 'claude-3', meta: { foo: 1 } });

    const content = stub.files.get(`${DIR}/sess1.jsonl`);
    expect(content).toBeDefined();
    const record = JSON.parse(content!.trim()) as TrajectoryRecord;
    expect(record.kind).toBe('session_open');
    expect(record.sessionId).toBe('sess1');
    if (record.kind === 'session_open') {
      expect(record.startedAt).toBe(FIXED_NOW);
      expect(record.taskId).toBe('task-abc');
      expect(record.cwd).toBe('/work');
      expect(record.model).toBe('claude-3');
      expect(record.meta).toEqual({ foo: 1 });
    }
  });

  // 3. autoOpen=true (default): recordRaw before openSession triggers auto session_open + raw record
  it('autoOpen: recordRaw before openSession auto-emits session_open', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW, autoOpen: true });
    const ev: FCEvent = { type: 'stderr', line: 'hello' };
    await rec.recordRaw('sess2', ev);

    const content = stub.files.get(`${DIR}/sess2.jsonl`)!;
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as TrajectoryRecord;
    const second = JSON.parse(lines[1]) as TrajectoryRecord;
    expect(first.kind).toBe('session_open');
    expect(second.kind).toBe('raw');
  });

  // 4. autoOpen=false: recordRaw before openSession throws
  it('autoOpen=false: recordRaw before openSession throws', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW, autoOpen: false });
    const ev: FCEvent = { type: 'stderr', line: 'hello' };
    await expect(rec.recordRaw('sess3', ev)).rejects.toThrow(/openSession/);
  });

  // 5. Each method writes a single line ending with '\n'
  it('each record is a single line ending with newline', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess4');
    const content = stub.files.get(`${DIR}/sess4.jsonl`)!;
    expect(content.endsWith('\n')).toBe(true);
    expect(content.split('\n').filter(Boolean)).toHaveLength(1);
  });

  // 6. Records are valid JSON
  it('records are valid JSON', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess5');
    await rec.note('sess5', 'info', 'test message');
    const content = stub.files.get(`${DIR}/sess5.jsonl`)!;
    for (const line of content.split('\n').filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // 7. closeSession appends session_close record
  it('closeSession appends session_close record', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess6');
    await rec.closeSession('sess6', 'success', 'done');
    const content = stub.files.get(`${DIR}/sess6.jsonl`)!;
    const lines = content.split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]) as TrajectoryRecord;
    expect(last.kind).toBe('session_close');
    if (last.kind === 'session_close') {
      expect(last.status).toBe('success');
      expect(last.reason).toBe('done');
    }
  });

  // 8. listSessions returns sessionIds for *.jsonl files
  it('listSessions returns session ids from .jsonl files', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('alpha');
    await rec.openSession('beta');
    // manually add a non-jsonl file to the stub fs to verify filtering
    stub.files.set(`${DIR}/other.gz`, 'garbage');

    const sessions = await rec.listSessions();
    expect(sessions).toContain('alpha');
    expect(sessions).toContain('beta');
    expect(sessions).not.toContain('other.gz');
    expect(sessions.every(s => !s.endsWith('.jsonl'))).toBe(true);
  });

  // 9. readSession returns parsed records in order
  it('readSession returns parsed records in order', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess7');
    await rec.note('sess7', 'info', 'first');
    await rec.note('sess7', 'warn', 'second');
    await rec.closeSession('sess7', 'success');

    const records = await rec.readSession('sess7');
    expect(records).toHaveLength(4);
    expect(records[0].kind).toBe('session_open');
    expect(records[1].kind).toBe('note');
    expect(records[2].kind).toBe('note');
    expect(records[3].kind).toBe('session_close');
  });

  // 10. readSession skips malformed lines without throwing
  it('readSession skips malformed lines silently', async () => {
    stub.files.set(`${DIR}/broken.jsonl`, '{"kind":"session_open","sessionId":"broken","startedAt":1}\nNOT JSON AT ALL\n{"kind":"session_close","sessionId":"broken","ts":2,"status":"success"}\n');
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs });
    const records = await rec.readSession('broken');
    expect(records).toHaveLength(2);
    expect(records[0].kind).toBe('session_open');
    expect(records[1].kind).toBe('session_close');
  });

  // 11. Sanitization: sessionId with '/' is replaced with '_' in filename
  it('sanitizes sessionId for filename', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('foo/bar/baz');

    const expectedPath = `${DIR}/foo_bar_baz.jsonl`;
    expect(stub.files.has(expectedPath)).toBe(true);
    expect(rec.pathFor('foo/bar/baz')).toBe(expectedPath);
  });

  // 11b. pathFor reflects sanitized name
  it('pathFor returns path with sanitized sessionId', () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs });
    expect(rec.pathFor('my session!')).toBe(`${DIR}/my_session_.jsonl`);
  });

  // 12. Concurrent recordRaw calls for same session are serialized
  it('concurrent recordRaw for same session are serialized in submission order', async () => {
    const appendOrder: string[] = [];
    const delayedFs: TrajectoryFs = {
      ...stub.fs,
      async appendFile(p, data) {
        const parsed = (() => { try { return JSON.parse(data.trim()); } catch { return null; } })();
        const label = parsed?.kind === 'note' ? parsed.text : parsed?.kind ?? '?';
        appendOrder.push(label);
        if (label === 'first') await new Promise(r => setTimeout(r, 20));
        stub.files.set(p, (stub.files.get(p) ?? '') + data);
      },
    };

    const rec = createTrajectoryRecorder({ dir: DIR, fs: delayedFs, now: () => FIXED_NOW, autoOpen: false });
    await rec.openSession('concurrent');

    // Fire all three without awaiting individually
    const p1 = rec.note('concurrent', 'info', 'first');
    const p2 = rec.note('concurrent', 'info', 'second');
    const p3 = rec.note('concurrent', 'info', 'third');
    await Promise.all([p1, p2, p3]);

    // session_open is first; then notes in submission order
    const noteOrder = appendOrder.filter(l => ['first', 'second', 'third'].includes(l));
    expect(noteOrder).toEqual(['first', 'second', 'third']);
  });

  // 13. Concurrent recordRaw for DIFFERENT sessions can interleave (no global lock)
  it('concurrent records for different sessions do not block each other', async () => {
    const completionOrder: string[] = [];
    const delayedFs: TrajectoryFs = {
      ...stub.fs,
      async appendFile(p, data) {
        stub.files.set(p, (stub.files.get(p) ?? '') + data);
        const parsed = (() => { try { return JSON.parse(data.trim()); } catch { return null; } })();
        if (parsed?.kind === 'note') {
          const delay = parsed.text === 'slow' ? 30 : 1;
          await new Promise(r => setTimeout(r, delay));
          completionOrder.push(parsed.text);
        }
      },
    };

    const rec = createTrajectoryRecorder({ dir: DIR, fs: delayedFs, now: () => FIXED_NOW });
    await rec.openSession('s-slow');
    await rec.openSession('s-fast');

    const p1 = rec.note('s-slow', 'info', 'slow');
    const p2 = rec.note('s-fast', 'info', 'fast');
    await Promise.all([p1, p2]);

    // 'fast' should complete before 'slow' since they are on different chains
    expect(completionOrder[0]).toBe('fast');
    expect(completionOrder[1]).toBe('slow');
  });

  // 14. recordEnvelope: serializes envelope into kind='envelope' record
  it('recordEnvelope writes kind=envelope record', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess-env');
    const envelope: FCEnvelope = {
      status: 'success',
      filesTouched: ['a.ts'],
      commandsRun: ['tsc'],
      exitCode: 0,
    };
    await rec.recordEnvelope('sess-env', envelope);

    const content = stub.files.get(`${DIR}/sess-env.jsonl`)!;
    const lines = content.split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]) as TrajectoryRecord;
    expect(last.kind).toBe('envelope');
    if (last.kind === 'envelope') {
      expect(last.envelope.status).toBe('success');
      expect(last.ts).toBe(FIXED_NOW);
    }
  });

  // 15. note: emits kind='note' with level/text/meta
  it('note writes kind=note record with all fields', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess-note');
    await rec.note('sess-note', 'error', 'something went wrong', { code: 42 });

    const content = stub.files.get(`${DIR}/sess-note.jsonl`)!;
    const lines = content.split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]) as TrajectoryRecord;
    expect(last.kind).toBe('note');
    if (last.kind === 'note') {
      expect(last.level).toBe('error');
      expect(last.text).toBe('something went wrong');
      expect(last.meta).toEqual({ code: 42 });
      expect(last.ts).toBe(FIXED_NOW);
    }
  });

  // Extra: recordTyped writes kind=typed record
  it('recordTyped writes kind=typed record', async () => {
    const rec = createTrajectoryRecorder({ dir: DIR, fs: stub.fs, now: () => FIXED_NOW });
    await rec.openSession('sess-typed');
    const ev: FcEvent = { type: 'Thinking', text: 'thinking...', ts: FIXED_NOW };
    await rec.recordTyped('sess-typed', ev);

    const content = stub.files.get(`${DIR}/sess-typed.jsonl`)!;
    const lines = content.split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]) as TrajectoryRecord;
    expect(last.kind).toBe('typed');
    if (last.kind === 'typed') {
      expect(last.event.type).toBe('Thinking');
    }
  });
});
