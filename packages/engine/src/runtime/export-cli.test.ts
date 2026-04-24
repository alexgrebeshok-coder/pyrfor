// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

import { exportTrajectoriesToFile } from './export-cli.js';
import { TrajectoryRecorder, type TrajectoryRecord } from './trajectory.js';

// ── Temp-dir helpers ───────────────────────────────────────────────────────

const TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__export_cli_test_tmp__',
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

// ── Test data helpers ──────────────────────────────────────────────────────

async function readLines(filePath: string): Promise<string[]> {
  const lines: string[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  await new Promise<void>((resolve, reject) => {
    rl.on('line', (l) => {
      if (l.trim()) lines.push(l.trim());
    });
    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
  return lines;
}

interface RecordOverrides {
  channel?: string;
  success?: boolean;
  private?: boolean;
  toolCalls?: TrajectoryRecord['toolCalls'];
  userInput?: string;
  finalAnswer?: string;
  startedAt?: string;
}

async function seedRecorder(
  baseDir: string,
  records: RecordOverrides[],
): Promise<TrajectoryRecorder> {
  const recorder = new TrajectoryRecorder({ baseDir, enabled: true, rotateBy: 'day' });
  for (const overrides of records) {
    const builder = recorder.begin({
      sessionId: 'sess-' + Math.random().toString(36).slice(2),
      channel: overrides.channel ?? 'cli',
      userInput: overrides.userInput ?? 'Hello world',
      private: overrides.private ?? false,
    });
    for (const tc of overrides.toolCalls ?? []) {
      builder.recordToolCall(tc);
    }
    await builder.finish({
      finalAnswer: overrides.finalAnswer ?? 'Hi there',
      success: overrides.success ?? true,
    });
  }
  return recorder;
}

const sampleTool = (): TrajectoryRecord['toolCalls'][number] => ({
  name: 'search',
  args: { q: 'test' },
  result: { hits: 1 },
  success: true,
  latencyMs: 50,
  timestamp: new Date().toISOString(),
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('exportTrajectoriesToFile — sharegpt format', () => {
  it('produces valid JSONL with conversations array', async () => {
    const baseDir = await makeTestDir('sg-basic');
    await seedRecorder(baseDir, [{ userInput: 'Who are you?', finalAnswer: 'I am Pyrfor.' }]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({ baseDir, outPath, format: 'sharegpt' });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.formatUsed).toBe('sharegpt');

    const lines = await readLines(outPath);
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]);
    expect(obj).toHaveProperty('conversations');
    const convs = obj.conversations as Array<{ from: string; value: string }>;
    expect(convs[0]).toEqual({ from: 'human', value: 'Who are you?' });
    expect(convs[convs.length - 1]).toEqual({ from: 'gpt', value: 'I am Pyrfor.' });
  });

  it('includes tool_calls conversation turn when tools were used', async () => {
    const baseDir = await makeTestDir('sg-tools');
    await seedRecorder(baseDir, [{ toolCalls: [sampleTool()] }]);

    const outPath = path.join(baseDir, 'out.jsonl');
    await exportTrajectoriesToFile({ baseDir, outPath, format: 'sharegpt' });

    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]);
    const convs: Array<{ from: string; value: string }> = obj.conversations;
    expect(convs.map((c) => c.from)).toEqual(['human', 'tool_calls', 'gpt']);
  });
});

describe('exportTrajectoriesToFile — jsonl format', () => {
  it('preserves raw TrajectoryRecord fields', async () => {
    const baseDir = await makeTestDir('jsonl-raw');
    await seedRecorder(baseDir, [{ userInput: 'raw test', channel: 'telegram' }]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({ baseDir, outPath, format: 'jsonl' });

    expect(result.exported).toBe(1);
    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]) as TrajectoryRecord;
    expect(obj.userInput).toBe('raw test');
    expect(obj.channel).toBe('telegram');
    expect(obj).toHaveProperty('id');
    expect(obj).toHaveProperty('toolCalls');
  });
});

describe('exportTrajectoriesToFile — openai format', () => {
  it('produces messages array with system/user/assistant roles', async () => {
    const baseDir = await makeTestDir('oai-roles');
    await seedRecorder(baseDir, [{ userInput: 'Summarise', finalAnswer: 'Done.' }]);

    const outPath = path.join(baseDir, 'out.jsonl');
    await exportTrajectoriesToFile({ baseDir, outPath, format: 'openai' });

    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]);
    const msgs: Array<{ role: string; content: string }> = obj.messages;
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are Pyrfor.' });
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'Summarise' });
    expect(msgs[2]).toMatchObject({ role: 'assistant', content: 'Done.' });
  });

  it('converts tool calls to OpenAI tool_calls schema', async () => {
    const baseDir = await makeTestDir('oai-tools');
    await seedRecorder(baseDir, [{ toolCalls: [sampleTool()] }]);

    const outPath = path.join(baseDir, 'out.jsonl');
    await exportTrajectoriesToFile({ baseDir, outPath, format: 'openai' });

    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]);
    const assistantMsg = (obj.messages as Array<{ role: string; tool_calls?: unknown[] }>).find(
      (m) => m.role === 'assistant',
    );
    expect(assistantMsg?.tool_calls).toBeDefined();
    const tc = (assistantMsg!.tool_calls as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>)[0];
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('search');
    expect(JSON.parse(tc.function.arguments)).toEqual({ q: 'test' });
  });
});

describe('exportTrajectoriesToFile — filters', () => {
  it('since/until filters by startedAt', async () => {
    const baseDir = await makeTestDir('filter-dates');
    const recorder = new TrajectoryRecorder({ baseDir, enabled: true, rotateBy: 'day' });

    // Write file directly with specific dates to control startedAt
    const old: TrajectoryRecord = {
      id: 'r1',
      sessionId: 's1',
      channel: 'cli',
      userInput: 'old',
      toolCalls: [],
      finalAnswer: 'old answer',
      success: true,
      iterations: 1,
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      startedAt: '2020-01-01T00:00:00.000Z',
      completedAt: '2020-01-01T00:00:01.000Z',
      durationMs: 1000,
      private: false,
    };
    const recent: TrajectoryRecord = {
      ...old,
      id: 'r2',
      userInput: 'recent',
      finalAnswer: 'recent answer',
      startedAt: '2024-06-01T00:00:00.000Z',
      completedAt: '2024-06-01T00:00:01.000Z',
    };
    // Write JSONL directly (bypass begin/finish to control timestamps)
    await fsp.writeFile(
      path.join(baseDir, 'trajectories-2024-06-01.jsonl'),
      JSON.stringify(old) + '\n' + JSON.stringify(recent) + '\n',
      'utf8',
    );

    void recorder; // not used further

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({
      baseDir,
      outPath,
      format: 'jsonl',
      since: new Date('2023-01-01T00:00:00.000Z'),
    });

    expect(result.exported).toBe(1);
    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]) as TrajectoryRecord;
    expect(obj.userInput).toBe('recent');
  });

  it('channel filter includes only matching records', async () => {
    const baseDir = await makeTestDir('filter-channel');
    await seedRecorder(baseDir, [
      { channel: 'telegram', userInput: 'telegram message' },
      { channel: 'cli', userInput: 'cli message' },
    ]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({
      baseDir,
      outPath,
      format: 'jsonl',
      channel: 'telegram',
    });

    expect(result.exported).toBe(1);
    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]) as TrajectoryRecord;
    expect(obj.channel).toBe('telegram');
    expect(obj.userInput).toBe('telegram message');
  });

  it('successOnly skips failed trajectories', async () => {
    const baseDir = await makeTestDir('filter-success');
    await seedRecorder(baseDir, [
      { success: true, userInput: 'ok' },
      { success: false, userInput: 'fail' },
    ]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({
      baseDir,
      outPath,
      format: 'jsonl',
      successOnly: true,
    });

    expect(result.exported).toBe(1);
    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]) as TrajectoryRecord;
    expect(obj.userInput).toBe('ok');
  });

  it('includePrivate=false (default) skips private:true records', async () => {
    const baseDir = await makeTestDir('filter-private');
    await seedRecorder(baseDir, [
      { private: false, userInput: 'public' },
      { private: true, userInput: 'private' },
    ]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({ baseDir, outPath, format: 'jsonl' });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(1);
    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]) as TrajectoryRecord;
    expect(obj.userInput).toBe('public');
  });

  it('includePrivate=true exports private records', async () => {
    const baseDir = await makeTestDir('filter-private-include');
    await seedRecorder(baseDir, [
      { private: true, userInput: 'secret' },
    ]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({
      baseDir,
      outPath,
      format: 'jsonl',
      includePrivate: true,
    });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('minToolCalls skips trajectories with fewer tool calls', async () => {
    const baseDir = await makeTestDir('filter-min-tools');
    await seedRecorder(baseDir, [
      { toolCalls: [], userInput: 'no tools' },
      { toolCalls: [sampleTool()], userInput: 'one tool' },
      { toolCalls: [sampleTool(), sampleTool()], userInput: 'two tools' },
    ]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({
      baseDir,
      outPath,
      format: 'jsonl',
      minToolCalls: 2,
    });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(2);
    const lines = await readLines(outPath);
    const obj = JSON.parse(lines[0]) as TrajectoryRecord;
    expect(obj.userInput).toBe('two tools');
  });
});

describe('exportTrajectoriesToFile — file system behaviour', () => {
  it('auto-creates parent directory for outPath', async () => {
    const baseDir = await makeTestDir('mkdir-test');
    await seedRecorder(baseDir, [{}]);

    const outPath = path.join(baseDir, 'nested', 'deep', 'dir', 'out.jsonl');
    const result = await exportTrajectoriesToFile({ baseDir, outPath, format: 'jsonl' });

    expect(result.exported).toBe(1);
    await expect(fsp.access(outPath)).resolves.toBeUndefined();
  });

  it('empty trajectories → empty file, exported=0', async () => {
    const baseDir = await makeTestDir('empty');
    // no records seeded

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({ baseDir, outPath, format: 'sharegpt' });

    expect(result.exported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.bytes).toBe(0);
    const content = await fsp.readFile(outPath, 'utf8');
    expect(content).toBe('');
  });

  it('byte count matches actual file size', async () => {
    const baseDir = await makeTestDir('byte-count');
    await seedRecorder(baseDir, [{ userInput: 'a', finalAnswer: 'b' }]);

    const outPath = path.join(baseDir, 'out.jsonl');
    const result = await exportTrajectoriesToFile({ baseDir, outPath, format: 'jsonl' });

    const stat = await fsp.stat(outPath);
    expect(result.bytes).toBe(stat.size);
  });

  it('concurrent exports to different files do not interfere', async () => {
    const baseDir = await makeTestDir('concurrent');
    await seedRecorder(baseDir, [
      { userInput: 'alpha', finalAnswer: 'A' },
      { userInput: 'beta', finalAnswer: 'B' },
      { userInput: 'gamma', finalAnswer: 'C' },
    ]);

    const outA = path.join(baseDir, 'outA.jsonl');
    const outB = path.join(baseDir, 'outB.jsonl');
    const outC = path.join(baseDir, 'outC.jsonl');

    const [rA, rB, rC] = await Promise.all([
      exportTrajectoriesToFile({ baseDir, outPath: outA, format: 'sharegpt' }),
      exportTrajectoriesToFile({ baseDir, outPath: outB, format: 'jsonl' }),
      exportTrajectoriesToFile({ baseDir, outPath: outC, format: 'openai' }),
    ]);

    expect(rA.exported).toBe(3);
    expect(rB.exported).toBe(3);
    expect(rC.exported).toBe(3);

    const linesA = await readLines(outA);
    const linesB = await readLines(outB);
    const linesC = await readLines(outC);
    expect(linesA).toHaveLength(3);
    expect(linesB).toHaveLength(3);
    expect(linesC).toHaveLength(3);

    // Formats are correct for each file
    expect(JSON.parse(linesA[0])).toHaveProperty('conversations');
    expect(JSON.parse(linesB[0])).toHaveProperty('id');
    expect(JSON.parse(linesC[0])).toHaveProperty('messages');
  });
});
