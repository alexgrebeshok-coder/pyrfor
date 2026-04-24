// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runRalph } from './ralph-runner.js';
import type { RalphAgentRunner } from './ralph-runner.js';
import type { RalphSpec } from './ralph-spec.js';
import type { VerifyCheck } from './verify-engine.js';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeSpec(overrides: Partial<RalphSpec> = {}): RalphSpec {
  return {
    agent: 'test',
    task: 'Test task',
    maxIterations: 3,
    scoreThreshold: 80,
    promptTemplate: 'Iteration: {{ iteration }}',
    commands: { tests: 'echo ok' },
    exitToken: '<promise>COMPLETE</promise>',
    ...overrides,
  };
}

function makeAgent(output: string): RalphAgentRunner {
  return { run: vi.fn().mockResolvedValue({ output }) };
}

const passingCheck: VerifyCheck = { name: 'ok', command: 'exit 0', weight: 100 };
const failingCheck: VerifyCheck = { name: 'fail', command: 'exit 1', weight: 100 };

const tmpFiles: string[] = [];
afterEach(async () => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    try {
      await fsp.unlink(f);
    } catch {
      // ignore
    }
  }
});

describe('runRalph', () => {
  it('completes when agent emits exitToken', async () => {
    const r = await runRalph({
      spec: makeSpec(),
      agent: makeAgent('done <promise>COMPLETE</promise>'),
      checks: [passingCheck],
    });
    expect(r.status).toBe('completed');
  });

  it('continues when score below threshold — reaches maxIterations', async () => {
    const r = await runRalph({
      spec: makeSpec({ maxIterations: 2 }),
      agent: makeAgent('working...'),
      checks: [failingCheck],
    });
    expect(r.status).toBe('max_iterations');
    expect(r.iterations.length).toBe(2);
  });

  it('max_iterations status set when iterations exhausted', async () => {
    const r = await runRalph({
      spec: makeSpec({ maxIterations: 1 }),
      agent: makeAgent('still working'),
      checks: [failingCheck],
    });
    expect(r.status).toBe('max_iterations');
  });

  it('abort signal aborts loop immediately', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await runRalph({
      spec: makeSpec(),
      agent: makeAgent('hi'),
      checks: [passingCheck],
      abortSignal: ctrl.signal,
    });
    expect(r.status).toBe('aborted');
  });

  it('onProgress fires every iteration', async () => {
    const onProgress = vi.fn();
    await runRalph({
      spec: makeSpec({ maxIterations: 2 }),
      agent: makeAgent('nope'),
      checks: [failingCheck],
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('progressFile written as JSONL', async () => {
    const file = path.join(__dirname, `__ralph_progress_${Date.now()}.jsonl`);
    tmpFiles.push(file);
    await runRalph({
      spec: makeSpec({ maxIterations: 1 }),
      agent: makeAgent('working'),
      checks: [failingCheck],
      progressFile: file,
    });
    const data = await fsp.readFile(file, 'utf8');
    const lines = data.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.iteration).toBe(1);
  });

  it('prompt rendered with iteration count', async () => {
    const agent = makeAgent('done <promise>COMPLETE</promise>');
    await runRalph({
      spec: makeSpec({ promptTemplate: 'iter={{ iteration }}' }),
      agent,
      checks: [passingCheck],
    });
    const calls = (agent.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toContain('iter=1');
  });

  it('lessons injected into prompt', async () => {
    const agent = makeAgent('done <promise>COMPLETE</promise>');
    await runRalph({
      spec: makeSpec({ promptTemplate: 'L:{{ lessons }}' }),
      agent,
      checks: [passingCheck],
      lessons: 'remember X',
    });
    const calls = (agent.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toContain('remember X');
  });

  it('agent error → continue with score 0', async () => {
    const agent: RalphAgentRunner = {
      run: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const r = await runRalph({
      spec: makeSpec({ maxIterations: 1 }),
      agent,
      checks: [passingCheck],
    });
    expect(r.iterations.length).toBe(1);
    expect(r.iterations[0]!.score).toBe(0);
    expect(r.status).toBe('max_iterations');
  });

  it('final result contains all iterations', async () => {
    const r = await runRalph({
      spec: makeSpec({ maxIterations: 2 }),
      agent: makeAgent('nope'),
      checks: [failingCheck],
    });
    expect(r.iterations.length).toBe(2);
  });

  it('exitToken without verify pass still completes', async () => {
    const r = await runRalph({
      spec: makeSpec(),
      agent: makeAgent('done <promise>COMPLETE</promise>'),
      checks: [failingCheck],
    });
    expect(r.status).toBe('completed');
    expect(r.finalScore).toBe(100);
  });

  it('empty checks tolerated — passes when default total >= threshold', async () => {
    const r = await runRalph({
      spec: makeSpec({ maxIterations: 1 }),
      agent: makeAgent('working'),
      checks: [],
    });
    expect(r.status).toBe('completed');
    expect(r.finalScore).toBe(100);
  });
});
