// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

import {
  TrajectoryRecorder,
  type ToolCallTrace,
  type TrajectoryRecord,
} from './trajectory';

// ── Temp-dir helpers ───────────────────────────────────────────────────────

const TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__trajectory_test_tmp__',
);

const cleanupDirs: string[] = [];

async function makeTestDir(label: string): Promise<string> {
  await fsp.mkdir(TMP_BASE, { recursive: true });
  const dir = path.join(TMP_BASE, label + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
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

async function readLines(filePath: string): Promise<string[]> {
  const lines: string[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  await new Promise<void>((resolve, reject) => {
    rl.on('line', (l) => { if (l.trim()) lines.push(l.trim()); });
    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
  return lines;
}

function makeTrace(overrides?: Partial<ToolCallTrace>): ToolCallTrace {
  return {
    name: 'tool-x',
    args: { q: 1 },
    result: { ok: true },
    success: true,
    latencyMs: 42,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TrajectoryRecorder', () => {
  // ── 1. begin → finish writes exactly one valid JSON line ────────────────
  it('begin → finish writes one valid JSONL line', async () => {
    const dir = await makeTestDir('write-one');
    const rec = new TrajectoryRecorder({ baseDir: dir, enabled: true });

    const builder = rec.begin({
      sessionId: 'sess-1',
      channel: 'cli',
      userInput: 'hello',
    });
    const result = await builder.finish({ finalAnswer: 'world', success: true });

    const files = await fsp.readdir(dir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    expect(jsonlFiles).toHaveLength(1);

    const lines = await readLines(path.join(dir, jsonlFiles[0]));
    expect(lines).toHaveLength(1);

    const parsed: TrajectoryRecord = JSON.parse(lines[0]);
    expect(parsed.id).toBeTruthy();
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.channel).toBe('cli');
    expect(parsed.userInput).toBe('hello');
    expect(parsed.finalAnswer).toBe('world');
    expect(parsed.success).toBe(true);
    expect(parsed.startedAt).toBeTruthy();
    expect(parsed.completedAt).toBeTruthy();
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);

    // returned record matches written record
    expect(result.id).toBe(parsed.id);
  });

  // ── 2. cancel → no file written ─────────────────────────────────────────
  it('cancel does not write any file', async () => {
    const dir = await makeTestDir('cancel');
    const rec = new TrajectoryRecorder({ baseDir: dir });
    const builder = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });
    builder.cancel();

    const files = await fsp.readdir(dir);
    expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(0);
  });

  // ── 3. recordToolCall accumulates in the record ──────────────────────────
  it('recordToolCall accumulates tool calls', async () => {
    const dir = await makeTestDir('tool-calls');
    const rec = new TrajectoryRecorder({ baseDir: dir });
    const builder = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });

    builder.recordToolCall(makeTrace({ name: 'tool-a' }));
    builder.recordToolCall(makeTrace({ name: 'tool-b' }));
    builder.recordToolCall(makeTrace({ name: 'tool-c', success: false, errorMessage: 'oops' }));

    const record = await builder.finish({ finalAnswer: 'done', iterations: 3 });
    expect(record.toolCalls).toHaveLength(3);
    expect(record.toolCalls[0].name).toBe('tool-a');
    expect(record.toolCalls[1].name).toBe('tool-b');
    expect(record.toolCalls[2].name).toBe('tool-c');
    expect(record.toolCalls[2].errorMessage).toBe('oops');
    expect(record.iterations).toBe(3);
  });

  // ── 4. setProvider / addTokens recorded correctly ───────────────────────
  it('setProvider and addTokens are persisted', async () => {
    const dir = await makeTestDir('provider');
    const rec = new TrajectoryRecorder({ baseDir: dir });
    const builder = rec.begin({ sessionId: 's', channel: 'telegram', userInput: 'q' });

    builder.setProvider('openai', 'gpt-4o');
    builder.addTokens({ prompt: 100, completion: 50 });
    builder.addTokens({ prompt: 20, completion: 10 });

    const record = await builder.finish({ finalAnswer: 'ans', costUsd: 0.003 });
    expect(record.provider).toBe('openai');
    expect(record.model).toBe('gpt-4o');
    expect(record.tokensUsed.prompt).toBe(120);
    expect(record.tokensUsed.completion).toBe(60);
    expect(record.tokensUsed.total).toBe(180);
    expect(record.costUsd).toBe(0.003);
  });

  // ── 5. abortReason recorded ──────────────────────────────────────────────
  it('abortReason is recorded on failed runs', async () => {
    const dir = await makeTestDir('abort');
    const rec = new TrajectoryRecorder({ baseDir: dir });
    const builder = rec.begin({ sessionId: 's', channel: 'cron', userInput: 'heavy' });
    const record = await builder.finish({
      finalAnswer: '',
      success: false,
      abortReason: 'timeout',
    });
    expect(record.success).toBe(false);
    expect(record.abortReason).toBe('timeout');
  });

  // ── 6. activeCount tracks correctly ─────────────────────────────────────
  it('activeCount increments on begin and decrements on finish/cancel', async () => {
    const dir = await makeTestDir('active-count');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    expect(rec.activeCount()).toBe(0);

    const b1 = rec.begin({ sessionId: 's1', channel: 'cli', userInput: 'a' });
    expect(rec.activeCount()).toBe(1);

    const b2 = rec.begin({ sessionId: 's2', channel: 'cli', userInput: 'b' });
    expect(rec.activeCount()).toBe(2);

    b1.cancel();
    expect(rec.activeCount()).toBe(1);

    await b2.finish({ finalAnswer: 'done' });
    expect(rec.activeCount()).toBe(0);
  });

  // ── 7. concurrent builders → no interleaving ────────────────────────────
  it('concurrent builders produce non-interleaved JSONL lines', async () => {
    const dir = await makeTestDir('concurrent');
    const rec = new TrajectoryRecorder({ baseDir: dir });
    const N = 20;

    const builders = Array.from({ length: N }, (_, i) =>
      rec.begin({ sessionId: `s${i}`, channel: 'cli', userInput: `msg-${i}` }),
    );

    await Promise.all(
      builders.map((b, i) => b.finish({ finalAnswer: `answer-${i}` })),
    );

    const files = await fsp.readdir(dir);
    const jsonlFile = path.join(dir, files.find((f) => f.endsWith('.jsonl'))!);
    const lines = await readLines(jsonlFile);
    expect(lines).toHaveLength(N);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      const rec2: TrajectoryRecord = JSON.parse(line);
      expect(rec2.id).toBeTruthy();
      expect(rec2.finalAnswer).toMatch(/^answer-\d+$/);
    }
  });

  // ── 8. query returns all records ─────────────────────────────────────────
  it('query returns all written records', async () => {
    const dir = await makeTestDir('query-all');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    for (let i = 0; i < 5; i++) {
      const b = rec.begin({ sessionId: `s${i}`, channel: 'cli', userInput: `u${i}` });
      await b.finish({ finalAnswer: `a${i}` });
    }

    const results = await rec.query();
    expect(results).toHaveLength(5);
  });

  // ── 9. query filters by channel ──────────────────────────────────────────
  it('query filters by channel', async () => {
    const dir = await makeTestDir('query-channel');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b1 = rec.begin({ sessionId: 's1', channel: 'telegram', userInput: 'tg' });
    await b1.finish({ finalAnswer: 'r1' });

    const b2 = rec.begin({ sessionId: 's2', channel: 'cli', userInput: 'cli' });
    await b2.finish({ finalAnswer: 'r2' });

    const b3 = rec.begin({ sessionId: 's3', channel: 'telegram', userInput: 'tg2' });
    await b3.finish({ finalAnswer: 'r3' });

    const tgResults = await rec.query({ channel: 'telegram' });
    expect(tgResults).toHaveLength(2);
    expect(tgResults.every((r) => r.channel === 'telegram')).toBe(true);

    const cliResults = await rec.query({ channel: 'cli' });
    expect(cliResults).toHaveLength(1);
  });

  // ── 10. query filters by successOnly ─────────────────────────────────────
  it('query filters by successOnly', async () => {
    const dir = await makeTestDir('query-success');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b1 = rec.begin({ sessionId: 's1', channel: 'cli', userInput: 'ok' });
    await b1.finish({ finalAnswer: 'r1', success: true });

    const b2 = rec.begin({ sessionId: 's2', channel: 'cli', userInput: 'fail' });
    await b2.finish({ finalAnswer: '', success: false, abortReason: 'error' });

    const b3 = rec.begin({ sessionId: 's3', channel: 'cli', userInput: 'ok2' });
    await b3.finish({ finalAnswer: 'r3', success: true });

    const successOnly = await rec.query({ successOnly: true });
    expect(successOnly).toHaveLength(2);
    expect(successOnly.every((r) => r.success)).toBe(true);

    const all = await rec.query();
    expect(all).toHaveLength(3);
  });

  // ── 11. query filters by since ────────────────────────────────────────────
  it('query filters by since', async () => {
    const dir = await makeTestDir('query-since');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    // Write 3 records
    for (let i = 0; i < 3; i++) {
      const b = rec.begin({ sessionId: `s${i}`, channel: 'cli', userInput: `u${i}` });
      await b.finish({ finalAnswer: `a${i}` });
    }

    const all = await rec.query();
    expect(all).toHaveLength(3);

    // Filter with since = future date → 0 results
    const future = new Date(Date.now() + 10_000);
    const none = await rec.query({ since: future });
    expect(none).toHaveLength(0);

    // Filter with since = past date → all 3
    const past = new Date(Date.now() - 10_000);
    const all2 = await rec.query({ since: past });
    expect(all2).toHaveLength(3);
  });

  // ── 12. query filters by until ────────────────────────────────────────────
  it('query filters by until', async () => {
    const dir = await makeTestDir('query-until');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    for (let i = 0; i < 3; i++) {
      const b = rec.begin({ sessionId: `s${i}`, channel: 'cli', userInput: `u${i}` });
      await b.finish({ finalAnswer: `a${i}` });
    }

    // until = past date → 0 results
    const past = new Date(Date.now() - 10_000);
    const none = await rec.query({ until: past });
    expect(none).toHaveLength(0);

    // until = future date → all 3
    const future = new Date(Date.now() + 10_000);
    const all = await rec.query({ until: future });
    expect(all).toHaveLength(3);
  });

  // ── 13. query respects limit ──────────────────────────────────────────────
  it('query respects limit', async () => {
    const dir = await makeTestDir('query-limit');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    for (let i = 0; i < 10; i++) {
      const b = rec.begin({ sessionId: `s${i}`, channel: 'cli', userInput: `u${i}` });
      await b.finish({ finalAnswer: `a${i}` });
    }

    const limited = await rec.query({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  // ── 14. exportShareGpt produces correct ShareGPT lines ───────────────────
  it('exportShareGpt produces valid ShareGPT-format lines', async () => {
    const dir = await makeTestDir('export-sharegpt');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b = rec.begin({ sessionId: 's', channel: 'telegram', userInput: 'What is 2+2?' });
    b.recordToolCall(makeTrace({ name: 'calc' }));
    await b.finish({ finalAnswer: '4' });

    const outPath = path.join(dir, 'out.jsonl');
    const { exported, skipped } = await rec.exportShareGpt({ outPath });
    expect(exported).toBe(1);
    expect(skipped).toBe(0);

    const lines = await readLines(outPath);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty('conversations');
    expect(parsed.conversations[0]).toEqual({ from: 'human', value: 'What is 2+2?' });
    expect(parsed.conversations[1].from).toBe('tool_calls');
    expect(parsed.conversations[2]).toEqual({ from: 'gpt', value: '4' });
  });

  // ── 15. exportShareGpt omits tool_calls when empty ───────────────────────
  it('exportShareGpt omits tool_calls turn when no tool calls', async () => {
    const dir = await makeTestDir('export-no-tools');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'hello' });
    await b.finish({ finalAnswer: 'hi there' });

    const outPath = path.join(dir, 'out.jsonl');
    await rec.exportShareGpt({ outPath });

    const lines = await readLines(outPath);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.conversations).toHaveLength(2); // human + gpt only
    expect(parsed.conversations[0].from).toBe('human');
    expect(parsed.conversations[1].from).toBe('gpt');
  });

  // ── 16. exportShareGpt skips private:true records ────────────────────────
  it('exportShareGpt skips private records', async () => {
    const dir = await makeTestDir('export-private');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b1 = rec.begin({ sessionId: 's1', channel: 'cli', userInput: 'pub', private: false });
    await b1.finish({ finalAnswer: 'public answer' });

    const b2 = rec.begin({ sessionId: 's2', channel: 'cli', userInput: 'secret', private: true });
    await b2.finish({ finalAnswer: 'private answer' });

    const outPath = path.join(dir, 'out.jsonl');
    const { exported, skipped } = await rec.exportShareGpt({ outPath });
    expect(exported).toBe(1);
    expect(skipped).toBe(1);

    const lines = await readLines(outPath);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.conversations[0].value).toBe('pub');
  });

  // ── 17. exportShareGpt skips success:false records ───────────────────────
  it('exportShareGpt skips failed records', async () => {
    const dir = await makeTestDir('export-failed');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b1 = rec.begin({ sessionId: 's1', channel: 'cli', userInput: 'ok' });
    await b1.finish({ finalAnswer: 'great' });

    const b2 = rec.begin({ sessionId: 's2', channel: 'cli', userInput: 'bad' });
    await b2.finish({ finalAnswer: '', success: false, abortReason: 'error' });

    const outPath = path.join(dir, 'out.jsonl');
    const { exported, skipped } = await rec.exportShareGpt({ outPath });
    expect(exported).toBe(1);
    expect(skipped).toBe(1);
  });

  // ── 18. pruneOld deletes old files and keeps recent ones ─────────────────
  it('pruneOld deletes files older than retainDays and keeps recent ones', async () => {
    const dir = await makeTestDir('prune');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    // Create fake JSONL files with known date-based names
    const today = new Date();
    const oldDate = new Date(today);
    oldDate.setUTCDate(oldDate.getUTCDate() - 10);
    const recentDate = new Date(today);
    recentDate.setUTCDate(recentDate.getUTCDate() - 1);

    const oldFile = `trajectories-${oldDate.toISOString().slice(0, 10)}.jsonl`;
    const recentFile = `trajectories-${recentDate.toISOString().slice(0, 10)}.jsonl`;
    const todayFile = `trajectories-${today.toISOString().slice(0, 10)}.jsonl`;

    await fsp.writeFile(path.join(dir, oldFile), '{"id":"old"}\n');
    await fsp.writeFile(path.join(dir, recentFile), '{"id":"recent"}\n');
    await fsp.writeFile(path.join(dir, todayFile), '{"id":"today"}\n');

    const { deleted } = await rec.pruneOld(5); // retain 5 days
    expect(deleted).toBe(1);

    const remaining = await fsp.readdir(dir);
    const jsonlFiles = remaining.filter((f) => f.endsWith('.jsonl'));
    expect(jsonlFiles).toHaveLength(2);
    expect(jsonlFiles).not.toContain(oldFile);
    expect(jsonlFiles).toContain(recentFile);
    expect(jsonlFiles).toContain(todayFile);
  });

  // ── 19. pruneOld on empty / missing dir is safe ───────────────────────────
  it('pruneOld on missing baseDir returns 0 deleted', async () => {
    const dir = await makeTestDir('prune-missing');
    const rec = new TrajectoryRecorder({
      baseDir: path.join(dir, 'nonexistent'),
    });
    const { deleted } = await rec.pruneOld(7);
    expect(deleted).toBe(0);
  });

  // ── 20. maxFileSizeMb rotates to new file when size exceeded ─────────────
  it('maxFileSizeMb rotation creates a new file when size cap exceeded', async () => {
    const dir = await makeTestDir('size-rotate');
    // Cap at ~1 byte so every record forces a new file
    const rec = new TrajectoryRecorder({ baseDir: dir, maxFileSizeMb: 0.000001 });

    for (let i = 0; i < 3; i++) {
      const b = rec.begin({ sessionId: `s${i}`, channel: 'cli', userInput: `u${i}` });
      await b.finish({ finalAnswer: `a${i}` });
    }

    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
    // Each write should have rotated to a new file
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  // ── 21. disabled mode → no files written, finish returns stub ────────────
  it('disabled mode: begin/finish are no-ops that write nothing', async () => {
    const dir = await makeTestDir('disabled');
    const rec = new TrajectoryRecorder({ baseDir: dir, enabled: false });

    const builder = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });
    builder.recordToolCall(makeTrace());
    const record = await builder.finish({ finalAnswer: 'ignored' });

    // No files written
    let files: string[] = [];
    try {
      files = await fsp.readdir(dir);
    } catch {
      // dir might not exist — that's fine
    }
    expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(0);

    // Stub record has empty id
    expect(record.id).toBe('');
    expect(record.finalAnswer).toBe('ignored');
  });

  // ── 22. disabled mode: activeCount stays zero ─────────────────────────────
  it('disabled mode: activeCount stays 0', async () => {
    const dir = await makeTestDir('disabled-count');
    const rec = new TrajectoryRecorder({ baseDir: dir, enabled: false });

    expect(rec.activeCount()).toBe(0);
    const b = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });
    expect(rec.activeCount()).toBe(0); // noop builder never increments
    await b.finish({ finalAnswer: 'y' });
    expect(rec.activeCount()).toBe(0);
  });

  // ── 23. week rotation uses YYYY-WW filename ───────────────────────────────
  it('rotateBy week produces trajectories-YYYY-WW.jsonl filename', async () => {
    const dir = await makeTestDir('week-rotate');
    const rec = new TrajectoryRecorder({ baseDir: dir, rotateBy: 'week' });

    const b = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });
    await b.finish({ finalAnswer: 'y' });

    const files = await fsp.readdir(dir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    expect(jsonlFiles).toHaveLength(1);
    // Matches trajectories-YYYY-WW.jsonl
    expect(jsonlFiles[0]).toMatch(/^trajectories-\d{4}-\d{2}\.jsonl$/);
  });

  // ── 24. metadata is persisted ─────────────────────────────────────────────
  it('metadata is persisted in the record', async () => {
    const dir = await makeTestDir('metadata');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b = rec.begin({
      sessionId: 's',
      channel: 'gateway',
      userInput: 'q',
      userId: 'u-123',
      chatId: 'c-456',
      metadata: { env: 'prod', version: 2 },
    });
    const record = await builder_finish_alias(b);

    expect(record.userId).toBe('u-123');
    expect(record.chatId).toBe('c-456');
    expect(record.metadata).toEqual({ env: 'prod', version: 2 });
  });

  // ── 25. double-finish throws ──────────────────────────────────────────────
  it('calling finish twice throws an error', async () => {
    const dir = await makeTestDir('double-finish');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });
    await b.finish({ finalAnswer: 'first' });
    await expect(b.finish({ finalAnswer: 'second' })).rejects.toThrow();
  });

  // ── 26. cancel after finish is a no-op (does not throw) ──────────────────
  it('cancel after finish does not throw and activeCount stays correct', async () => {
    const dir = await makeTestDir('cancel-after-finish');
    const rec = new TrajectoryRecorder({ baseDir: dir });

    const b = rec.begin({ sessionId: 's', channel: 'cli', userInput: 'x' });
    await b.finish({ finalAnswer: 'done' });
    expect(rec.activeCount()).toBe(0);

    expect(() => b.cancel()).not.toThrow();
    expect(rec.activeCount()).toBe(0); // must not go negative
  });
});

// ── Helper alias to avoid TS variable scoping issues in test ────────────────
async function builder_finish_alias(
  b: import('./trajectory').TrajectoryBuilder,
): Promise<TrajectoryRecord> {
  return b.finish({ finalAnswer: 'done' });
}
