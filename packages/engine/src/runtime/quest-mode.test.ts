// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import {
  runQuest,
  defaultExecutor,
  saveQuestPlan,
  loadQuestPlan,
} from './quest-mode.js';
import type { QuestPlan, QuestSpec, QuestTask } from './quest-mode.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const baseSpec: QuestSpec = { title: 'Test Quest', goal: 'Test the quest system' };

function makePlan(id: string, overrides: Partial<QuestPlan> = {}): QuestPlan {
  const now = new Date().toISOString();
  return {
    spec: { id, title: 'Test', goal: 'G' },
    research: 'r',
    requirements: ['req1'],
    design: 'd',
    tasks: [],
    phase: 'done',
    startedAt: now,
    updatedAt: now,
    metrics: { tasksTotal: 0, tasksDone: 0, tasksFailed: 0, costUsd: 0 },
    ...overrides,
  };
}

// ── Per-test isolation ─────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'quest-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('runQuest', () => {
  it('end-to-end with default executor (no llmFn) → completes', async () => {
    const result = await runQuest({ spec: baseSpec, storeDir: tmpDir });
    expect(result.status).toBe('completed');
    expect(result.plan.phase).toBe('done');
    expect(result.plan.tasks).toHaveLength(1);
    expect(result.plan.tasks[0]!.title).toBe(`Implement: ${baseSpec.goal}`);
  });

  it('spec id auto-generated when missing', async () => {
    const result = await runQuest({ spec: baseSpec, storeDir: tmpDir });
    expect(result.plan.spec.id).toBeTruthy();
    expect(typeof result.plan.spec.id).toBe('string');
    expect(result.plan.spec.id.length).toBe(26); // ULID length
  });

  it('spec id preserved when provided', async () => {
    const result = await runQuest({
      spec: { ...baseSpec, id: 'MY-CUSTOM-ID' },
      storeDir: tmpDir,
    });
    expect(result.plan.spec.id).toBe('MY-CUSTOM-ID');
  });

  it('spec missing title → throws', async () => {
    await expect(
      runQuest({ spec: { title: '', goal: 'G' }, storeDir: tmpDir }),
    ).rejects.toThrow('spec.title is required');
  });

  it('spec missing goal → throws', async () => {
    await expect(
      runQuest({ spec: { title: 'T', goal: '' }, storeDir: tmpDir }),
    ).rejects.toThrow('spec.goal is required');
  });

  it('llmFn-driven: default research executor is invoked', async () => {
    const llmFn = vi.fn().mockResolvedValue('(llm response)');
    await runQuest({ spec: baseSpec, llmFn, storeDir: tmpDir });
    expect(llmFn).toHaveBeenCalled();
    const firstCall = llmFn.mock.calls[0]![0] as string;
    expect(firstCall).toContain(baseSpec.goal);
  });

  it('llmFn-driven: default requirements executor splits dash bullets', async () => {
    const llmFn = vi.fn().mockImplementation(async (p: string) => {
      if (p.includes('List requirements')) return '- req one\n- req two\n plain line';
      return '(other)';
    });
    const ex = defaultExecutor(llmFn);
    const reqs = await ex.requirements(baseSpec, 'research text');
    expect(reqs).toEqual(['req one', 'req two']);
  });

  it('llmFn-driven: default design executor is invoked', async () => {
    const llmFn = vi.fn().mockImplementation(async (p: string) => {
      if (p.includes('Design a solution')) return 'design output';
      return '(other)';
    });
    const ex = defaultExecutor(llmFn);
    const design = await ex.design(baseSpec, ['req1', 'req2']);
    expect(design).toBe('design output');
  });

  it('llmFn-driven: default tasks executor is invoked with goal and design', async () => {
    const llmFn = vi.fn().mockImplementation(async (p: string) => {
      if (p.includes('Break down')) return '- Task Alpha\n- Task Beta';
      return '(other)';
    });
    const ex = defaultExecutor(llmFn);
    const tasks = await ex.tasks(baseSpec, 'some design');
    expect(tasks.map((t) => t.title)).toEqual(['Task Alpha', 'Task Beta']);
  });

  it('requirements parser: splits dash bullet lines only', async () => {
    const llmFn = vi.fn().mockResolvedValue('- item one\nnot a bullet\n- item two\n  - nested');
    const ex = defaultExecutor(llmFn);
    const reqs = await ex.requirements(baseSpec, 'r');
    // Nested "  - nested" starts with spaces then "- " so trimStart().startsWith('- ') is true
    expect(reqs).toContain('item one');
    expect(reqs).toContain('item two');
    expect(reqs).not.toContain('not a bullet');
  });

  it('tasks parser: produces multiple tasks and trims whitespace', async () => {
    const llmFn = vi.fn().mockImplementation(async (p: string) => {
      if (p.includes('Break down'))
        return '- Task One  \n  description 1\n  more desc\n- Task Two\n  description 2  ';
      return '(other)';
    });
    const ex = defaultExecutor(llmFn);
    const tasks = await ex.tasks(baseSpec, 'design');
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toBe('Task One');
    expect(tasks[0]!.description).toBe('description 1\nmore desc');
    expect(tasks[1]!.title).toBe('Task Two');
    expect(tasks[1]!.description).toBe('description 2');
  });

  it('empty tasks list → skips execute phase, goes straight to verify', async () => {
    const phases: string[] = [];
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      executor: {
        tasks: async () => [],
        verify: async () => {
          phases.push('verify');
          return { ok: true, report: 'ok' };
        },
      },
      onProgress: (p) => phases.push(p.phase),
    });
    expect(result.status).toBe('completed');
    expect(phases).not.toContain('execute');
    expect(phases).toContain('verify');
  });

  it('topological order: dependency runs before dependent', async () => {
    const executionOrder: string[] = [];
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      executor: {
        tasks: async () => [
          { title: 'Task A', description: 'first', dependencies: [] },
          { title: 'Task B', description: 'second', dependencies: ['Task A'] },
        ],
        executeTask: async (task) => {
          executionOrder.push(task.title);
          return { ok: true, summary: 'done' };
        },
      },
    });
    expect(result.status).toBe('completed');
    expect(executionOrder).toEqual(['Task A', 'Task B']);
  });

  it('cycle detection → status=failed, phase=failed', async () => {
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      executor: {
        tasks: async () => [
          { title: 'Task A', description: '', dependencies: ['Task B'] },
          { title: 'Task B', description: '', dependencies: ['Task A'] },
        ],
      },
    });
    expect(result.status).toBe('failed');
    expect(result.plan.phase).toBe('failed');
  });

  it('task failure: retried up to maxAttemptsPerTask', async () => {
    let callCount = 0;
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      maxAttemptsPerTask: 3,
      executor: {
        tasks: async () => [{ title: 'Flaky', description: '', dependencies: [] }],
        executeTask: async () => {
          callCount++;
          return { ok: false, summary: 'failed attempt' };
        },
      },
    });
    expect(result.status).toBe('failed');
    expect(callCount).toBe(3); // tried 3 times
  });

  it('task ultimate failure → plan.phase=failed and short-circuits', async () => {
    let secondTaskCalled = false;
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      maxAttemptsPerTask: 1,
      executor: {
        tasks: async () => [
          { title: 'Task Fail', description: '', dependencies: [] },
          { title: 'Task Never', description: '', dependencies: [] },
        ],
        executeTask: async (task) => {
          if (task.title === 'Task Never') secondTaskCalled = true;
          return { ok: false, summary: 'always fails' };
        },
      },
    });
    expect(result.status).toBe('failed');
    expect(result.plan.phase).toBe('failed');
    expect(secondTaskCalled).toBe(false);
    expect(result.plan.metrics.tasksFailed).toBe(1);
  });

  it('abort during research phase → status=aborted', async () => {
    const ac = new AbortController();
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      abortSignal: ac.signal,
      executor: {
        research: async () => {
          ac.abort();
          return '(research done)';
        },
      },
    });
    expect(result.status).toBe('aborted');
  });

  it('abort between tasks → stops after first task', async () => {
    const ac = new AbortController();
    let execCount = 0;
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      abortSignal: ac.signal,
      executor: {
        tasks: async () => [
          { title: 'T1', description: '', dependencies: [] },
          { title: 'T2', description: '', dependencies: [] },
        ],
        executeTask: async () => {
          execCount++;
          ac.abort();
          return { ok: true, summary: 'done' };
        },
      },
    });
    expect(result.status).toBe('aborted');
    expect(execCount).toBe(1);
  });

  it('onProgress fires once per phase and once per task completion', async () => {
    const phases: string[] = [];
    await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      executor: {
        tasks: async () => [{ title: 'T', description: '', dependencies: [] }],
        executeTask: async () => ({ ok: true, summary: 's' }),
      },
      onProgress: (p) => phases.push(p.phase),
    });
    // Should have seen: research, requirements, design, tasks, execute,
    //   in_progress (per task attempt), done (per task), verify, report, done
    expect(phases).toContain('research');
    expect(phases).toContain('requirements');
    expect(phases).toContain('design');
    expect(phases).toContain('tasks');
    expect(phases).toContain('execute');
    expect(phases).toContain('verify');
    expect(phases).toContain('report');
    expect(phases).toContain('done');
    // At least one fire per phase (8 distinct phases) + 2 per task (in_progress + done)
    expect(phases.length).toBeGreaterThanOrEqual(10);
  });

  it('saveQuestPlan: writes plan.json atomically (no .tmp left behind)', () => {
    const plan = makePlan('save-test');
    const filePath = saveQuestPlan(tmpDir, plan);
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(filePath + '.tmp')).toBe(false);
  });

  it('loadQuestPlan: round-trips a saved plan', () => {
    const plan = makePlan('round-trip-id');
    saveQuestPlan(tmpDir, plan);
    const loaded = loadQuestPlan(tmpDir, 'round-trip-id');
    expect(loaded).toEqual(plan);
  });

  it('loadQuestPlan: returns null when file is missing', () => {
    const result = loadQuestPlan(tmpDir, 'does-not-exist');
    expect(result).toBeNull();
  });

  it('report file is written after report phase completes', async () => {
    const result = await runQuest({ spec: baseSpec, storeDir: tmpDir });
    expect(result.reportPath).toBeTruthy();
    expect(existsSync(result.reportPath!)).toBe(true);
  });

  it('report file content contains task summary list', async () => {
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      executor: {
        tasks: async () => [{ title: 'My Task', description: '', dependencies: [] }],
        executeTask: async () => ({ ok: true, summary: 'task summary here' }),
      },
    });
    const content = readFileSync(result.reportPath!, 'utf8');
    expect(content).toContain('My Task');
    expect(content).toContain('task summary here');
  });

  it('metrics: tasksTotal, tasksDone, tasksFailed updated correctly', async () => {
    let callCount = 0;
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      maxAttemptsPerTask: 1,
      executor: {
        tasks: async () => [
          { title: 'T1', description: '', dependencies: [] },
          { title: 'T2', description: '', dependencies: [] },
          { title: 'T3', description: '', dependencies: [] },
        ],
        executeTask: async () => {
          callCount++;
          // First 2 succeed, third fails
          return { ok: callCount <= 2, summary: 'r', costUsd: 0.01 };
        },
      },
    });
    expect(result.plan.metrics.tasksTotal).toBe(3);
    expect(result.plan.metrics.tasksDone).toBe(2);
    expect(result.plan.metrics.tasksFailed).toBe(1);
  });

  it('plan.spec.id is used as the quest directory name', async () => {
    const result = await runQuest({
      spec: { ...baseSpec, id: 'MY-QUEST-DIR' },
      storeDir: tmpDir,
    });
    const expectedDir = path.join(tmpDir, 'MY-QUEST-DIR');
    expect(existsSync(expectedDir)).toBe(true);
    expect(existsSync(path.join(expectedDir, 'plan.json'))).toBe(true);
    expect(result.plan.spec.id).toBe('MY-QUEST-DIR');
  });

  it('executeTask exception counted as attempt failure', async () => {
    let attempts = 0;
    const result = await runQuest({
      spec: baseSpec,
      storeDir: tmpDir,
      maxAttemptsPerTask: 2,
      executor: {
        tasks: async () => [{ title: 'Throws', description: '', dependencies: [] }],
        executeTask: async () => {
          attempts++;
          throw new Error('task exploded');
        },
      },
    });
    expect(result.status).toBe('failed');
    expect(attempts).toBe(2);
    expect(result.plan.tasks[0]!.result?.summary).toContain('exception: task exploded');
  });

  it('no llmFn: default research returns stub string', async () => {
    const ex = defaultExecutor();
    const r = await ex.research(baseSpec);
    expect(r).toBe('(no research executed)');
  });

  it('no llmFn: default requirements returns [goal]', async () => {
    const ex = defaultExecutor();
    const r = await ex.requirements(baseSpec, '');
    expect(r).toEqual([baseSpec.goal]);
  });

  it('no llmFn: default design returns stub string', async () => {
    const ex = defaultExecutor();
    const r = await ex.design(baseSpec, []);
    expect(r).toBe('(default minimal design)');
  });

  it('no llmFn: default tasks produces single implement task', async () => {
    const ex = defaultExecutor();
    const r = await ex.tasks(baseSpec, '');
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBe(`Implement: ${baseSpec.goal}`);
  });
});
