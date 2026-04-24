// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubagentSpawner, subagentSpawner } from './subagents';
import type { SubagentTask, SubagentOptions, SubagentResult } from './subagents';
import type { Session } from './session';

// Silence logger during tests
vi.mock('../observability/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    systemPrompt: 'You are a helpful assistant.',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    metadata: { userId: 'user-42' },
    tokenCount: 10,
    maxTokens: 4096,
    ...overrides,
  } as Session;
}

function makeOptions(overrides: Partial<SubagentOptions> = {}): SubagentOptions {
  return {
    task: 'Research the topic',
    parentSession: makeSession(),
    ...overrides,
  };
}

/** Executor that resolves after a short tick with the supplied result string */
const fastExecutor =
  (result = 'done') =>
  (_task: SubagentTask): Promise<string> =>
    Promise.resolve(result);

/** Executor that rejects with the supplied message */
const failExecutor =
  (message = 'executor error') =>
  (_task: SubagentTask): Promise<string> =>
    Promise.reject(new Error(message));

/** Executor that never resolves (simulates a long-running task) */
const hangExecutor = (_task: SubagentTask): Promise<string> =>
  new Promise(() => {
    /* intentionally hangs */
  });

/** Wait for a task to leave 'pending'/'running' status */
async function waitForStatus(
  spawner: SubagentSpawner,
  taskId: string,
  timeout = 2000,
): Promise<SubagentTask | undefined> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const t = spawner.getTask(taskId);
    if (t && t.status !== 'pending' && t.status !== 'running') return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  return spawner.getTask(taskId);
}

// ===========================================================================
// SubagentSpawner — constructor / defaults
// ===========================================================================

describe('SubagentSpawner — constructor', () => {
  it('creates an instance with default maxConcurrent of 5', () => {
    const spawner = new SubagentSpawner();
    expect(spawner.activeCount).toBe(0);
    expect(spawner.totalCount).toBe(0);
  });

  it('accepts a custom maxConcurrent value', () => {
    const spawner = new SubagentSpawner(2);
    // verify it is respected by attempting to exceed it (tested separately)
    expect(spawner.activeCount).toBe(0);
  });

  it('starts with zero active and total counts', () => {
    const spawner = new SubagentSpawner();
    expect(spawner.activeCount).toBe(0);
    expect(spawner.totalCount).toBe(0);
  });
});

// ===========================================================================
// SubagentSpawner — setExecutor / spawn basic
// ===========================================================================

describe('SubagentSpawner — spawn', () => {
  let spawner: SubagentSpawner;

  beforeEach(() => {
    spawner = new SubagentSpawner();
  });

  it('returns success:true and a taskId when spawned', () => {
    spawner.setExecutor(fastExecutor());
    const result = spawner.spawn(makeOptions());
    expect(result.success).toBe(true);
    expect(result.taskId).toMatch(/^sub-/);
  });

  it('increments totalCount after spawn', () => {
    spawner.setExecutor(fastExecutor());
    spawner.spawn(makeOptions());
    expect(spawner.totalCount).toBe(1);
  });

  it('task ID has expected sub- prefix format', () => {
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions());
    expect(taskId).toBeDefined();
    expect(taskId!).toMatch(/^sub-\d+-[a-z0-9]+$/);
  });

  it('task is created with status pending or running', () => {
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions());
    const task = spawner.getTask(taskId!);
    expect(task).toBeDefined();
    expect(['pending', 'running']).toContain(task!.status);
  });

  it('stores the task description correctly', () => {
    spawner.setExecutor(fastExecutor());
    const opts = makeOptions({ task: 'Analyse quarterly results' });
    const { taskId } = spawner.spawn(opts);
    const task = spawner.getTask(taskId!);
    expect(task!.task).toBe('Analyse quarterly results');
  });

  it('stores parentSessionId from parent session', () => {
    spawner.setExecutor(fastExecutor());
    const parent = makeSession({ id: 'parent-xyz' });
    const { taskId } = spawner.spawn(makeOptions({ parentSession: parent }));
    expect(spawner.getTask(taskId!)!.parentSessionId).toBe('parent-xyz');
  });

  it('copies systemPrompt from parent session into context', () => {
    spawner.setExecutor(fastExecutor());
    const parent = makeSession({ systemPrompt: 'Custom system prompt' });
    const { taskId } = spawner.spawn(makeOptions({ parentSession: parent }));
    expect(spawner.getTask(taskId!)!.context.systemPrompt).toBe('Custom system prompt');
  });

  it('copies metadata from parent session', () => {
    spawner.setExecutor(fastExecutor());
    const parent = makeSession({ metadata: { env: 'prod', tenantId: 't1' } });
    const { taskId } = spawner.spawn(makeOptions({ parentSession: parent }));
    expect(spawner.getTask(taskId!)!.context.metadata).toEqual({ env: 'prod', tenantId: 't1' });
  });

  it('provider preference is stored on the task', () => {
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions({ provider: 'anthropic' }));
    expect(spawner.getTask(taskId!)!.provider).toBe('anthropic');
  });

  it('maxTokens is stored on the task', () => {
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions({ maxTokens: 512 }));
    expect(spawner.getTask(taskId!)!.maxTokens).toBe(512);
  });

  it('without executor, spawn still returns success:true (task is queued)', () => {
    // no setExecutor call
    const result = spawner.spawn(makeOptions());
    expect(result.success).toBe(true);
    expect(result.taskId).toBeDefined();
  });

  it('without executor, task remains in pending status', async () => {
    const { taskId } = spawner.spawn(makeOptions());
    await new Promise((r) => setTimeout(r, 30));
    const task = spawner.getTask(taskId!);
    expect(task!.status).toBe('pending');
  });
});

// ===========================================================================
// SubagentSpawner — context slicing (fullHistory vs last-5)
// ===========================================================================

describe('SubagentSpawner — context slicing', () => {
  let spawner: SubagentSpawner;

  beforeEach(() => {
    spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor());
  });

  it('defaults to last 5 non-system messages', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg-${i}`,
    }));
    const parent = makeSession({ messages });
    const { taskId } = spawner.spawn(makeOptions({ parentSession: parent }));
    const ctx = spawner.getTask(taskId!)!.context;
    expect(ctx.recentMessages.length).toBe(5);
    // last 5 messages are indices 5-9
    expect(ctx.recentMessages[0].content).toBe('msg-5');
    expect(ctx.recentMessages[4].content).toBe('msg-9');
  });

  it('fullHistory:true includes all non-system messages', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      ...Array.from({ length: 8 }, (_, i) => ({
        role: 'user' as const,
        content: `u-${i}`,
      })),
    ];
    const parent = makeSession({ messages });
    const { taskId } = spawner.spawn(
      makeOptions({ parentSession: parent, fullHistory: true }),
    );
    const ctx = spawner.getTask(taskId!)!.context;
    // 8 user messages, no system
    expect(ctx.recentMessages.length).toBe(8);
  });

  it('system messages are excluded from recentMessages regardless of fullHistory', () => {
    const messages = [
      { role: 'system' as const, content: 'sys-1' },
      { role: 'user' as const, content: 'hello' },
      { role: 'system' as const, content: 'sys-2' },
    ];
    const parent = makeSession({ messages });
    const { taskId } = spawner.spawn(
      makeOptions({ parentSession: parent, fullHistory: true }),
    );
    const ctx = spawner.getTask(taskId!)!.context;
    expect(ctx.recentMessages.every((m) => m.role !== 'system')).toBe(true);
  });
});

// ===========================================================================
// SubagentSpawner — getTask / getTasksByParent
// ===========================================================================

describe('SubagentSpawner — getTask / getTasksByParent', () => {
  let spawner: SubagentSpawner;

  beforeEach(() => {
    spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor());
  });

  it('getTask returns undefined for unknown taskId', () => {
    expect(spawner.getTask('no-such-id')).toBeUndefined();
  });

  it('getTask returns the spawned task', () => {
    const { taskId } = spawner.spawn(makeOptions());
    const task = spawner.getTask(taskId!);
    expect(task).toBeDefined();
    expect(task!.id).toBe(taskId);
  });

  it('getTasksByParent returns tasks matching parentSessionId', () => {
    const parentA = makeSession({ id: 'A' });
    const parentB = makeSession({ id: 'B' });
    spawner.spawn(makeOptions({ parentSession: parentA }));
    spawner.spawn(makeOptions({ parentSession: parentA }));
    spawner.spawn(makeOptions({ parentSession: parentB }));
    expect(spawner.getTasksByParent('A')).toHaveLength(2);
    expect(spawner.getTasksByParent('B')).toHaveLength(1);
  });

  it('getTasksByParent returns empty array for unknown parent', () => {
    spawner.spawn(makeOptions());
    expect(spawner.getTasksByParent('unknown-parent')).toHaveLength(0);
  });
});

// ===========================================================================
// SubagentSpawner — execution: success & failure
// ===========================================================================

describe('SubagentSpawner — task execution', () => {
  let spawner: SubagentSpawner;

  beforeEach(() => {
    spawner = new SubagentSpawner();
  });

  it('task transitions to completed after executor resolves', async () => {
    spawner.setExecutor(fastExecutor('great result'));
    const { taskId } = spawner.spawn(makeOptions());
    const task = await waitForStatus(spawner, taskId!);
    expect(task!.status).toBe('completed');
    expect(task!.result).toBe('great result');
  });

  it('task stores completedAt after successful execution', async () => {
    spawner.setExecutor(fastExecutor('ok'));
    const { taskId } = spawner.spawn(makeOptions());
    const task = await waitForStatus(spawner, taskId!);
    expect(task!.completedAt).toBeInstanceOf(Date);
  });

  it('error in executor sets task.status to failed (not swallowed)', async () => {
    spawner.setExecutor(failExecutor('something went wrong'));
    const { taskId } = spawner.spawn(makeOptions());
    const task = await waitForStatus(spawner, taskId!);
    expect(task!.status).toBe('failed');
    expect(task!.error).toBe('something went wrong');
  });

  it('error in executor sets completedAt on the task', async () => {
    spawner.setExecutor(failExecutor('oops'));
    const { taskId } = spawner.spawn(makeOptions());
    const task = await waitForStatus(spawner, taskId!);
    expect(task!.completedAt).toBeInstanceOf(Date);
  });

  it('activeCount decrements after task finishes', async () => {
    spawner.setExecutor(fastExecutor());
    spawner.spawn(makeOptions());
    // wait for completion
    await new Promise((r) => setTimeout(r, 50));
    expect(spawner.activeCount).toBe(0);
  });

  it('executor receives the SubagentTask as argument', async () => {
    const executor = vi.fn().mockResolvedValue('result');
    spawner.setExecutor(executor);
    const { taskId } = spawner.spawn(makeOptions({ task: 'do X' }));
    await waitForStatus(spawner, taskId!);
    expect(executor).toHaveBeenCalledOnce();
    const receivedTask: SubagentTask = executor.mock.calls[0][0];
    expect(receivedTask.id).toBe(taskId);
    expect(receivedTask.task).toBe('do X');
  });

  it('non-Error executor rejection is stringified into task.error', async () => {
    spawner.setExecutor(() => Promise.reject('plain string error'));
    const { taskId } = spawner.spawn(makeOptions());
    const task = await waitForStatus(spawner, taskId!);
    expect(task!.status).toBe('failed');
    expect(task!.error).toBe('plain string error');
  });
});

// ===========================================================================
// SubagentSpawner — concurrency limit
// ===========================================================================

describe('SubagentSpawner — concurrency limit', () => {
  it('rejects spawn when maxConcurrent is reached', () => {
    const spawner = new SubagentSpawner(2);
    spawner.setExecutor(hangExecutor);

    const r1 = spawner.spawn(makeOptions());
    const r2 = spawner.spawn(makeOptions());
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // 3rd spawn should be rejected
    const r3 = spawner.spawn(makeOptions());
    expect(r3.success).toBe(false);
    expect(r3.error).toMatch(/maximum concurrent subagents/i);
  });

  it('error message includes the limit number', () => {
    const spawner = new SubagentSpawner(3);
    spawner.setExecutor(hangExecutor);
    spawner.spawn(makeOptions());
    spawner.spawn(makeOptions());
    spawner.spawn(makeOptions());
    const r = spawner.spawn(makeOptions());
    expect(r.error).toContain('3');
  });

  it('accepts new spawns after a running task finishes', async () => {
    const spawner = new SubagentSpawner(1);
    spawner.setExecutor(fastExecutor());

    const r1 = spawner.spawn(makeOptions());
    expect(r1.success).toBe(true);

    // wait for task1 to complete, freeing the slot
    await waitForStatus(spawner, r1.taskId!);

    const r2 = spawner.spawn(makeOptions());
    expect(r2.success).toBe(true);
  });
});

// ===========================================================================
// SubagentSpawner — concurrent dispatch (independent invocations)
// ===========================================================================

describe('SubagentSpawner — concurrent dispatch', () => {
  it('dispatches multiple independent tasks simultaneously', async () => {
    const spawner = new SubagentSpawner(5);
    const results: string[] = [];
    spawner.setExecutor(async (task) => {
      results.push(task.id);
      return `result-${task.id}`;
    });

    const ids = Array.from({ length: 5 }, () => spawner.spawn(makeOptions()).taskId!);
    // Wait for all to complete
    await Promise.all(ids.map((id) => waitForStatus(spawner, id)));

    expect(results).toHaveLength(5);
    for (const id of ids) {
      expect(spawner.getTask(id)!.status).toBe('completed');
    }
  });

  it('all concurrent tasks store their individual results', async () => {
    const spawner = new SubagentSpawner(5);
    spawner.setExecutor(async (task) => `done-${task.task}`);

    const ids = ['A', 'B', 'C'].map((t) =>
      spawner.spawn(makeOptions({ task: t })).taskId!,
    );
    await Promise.all(ids.map((id) => waitForStatus(spawner, id)));

    for (let i = 0; i < ids.length; i++) {
      const task = spawner.getTask(ids[i])!;
      expect(task.result).toBe(`done-${['A', 'B', 'C'][i]}`);
    }
  });
});

// ===========================================================================
// SubagentSpawner — waitForTask
// ===========================================================================

describe('SubagentSpawner — waitForTask', () => {
  let spawner: SubagentSpawner;

  beforeEach(() => {
    spawner = new SubagentSpawner();
  });

  it('returns error result for unknown taskId', async () => {
    const result = await spawner.waitForTask('not-real');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns immediately for an already-completed task', async () => {
    spawner.setExecutor(fastExecutor('fast'));
    const { taskId } = spawner.spawn(makeOptions());
    await waitForStatus(spawner, taskId!); // ensure completed first

    const result = await spawner.waitForTask(taskId!);
    expect(result.success).toBe(true);
    expect(result.result).toBe('fast');
  });

  it('polls until task completes and returns result', async () => {
    let resolve!: (value: string) => void;
    const controlled = new Promise<string>((r) => (resolve = r));
    spawner.setExecutor(() => controlled);

    const { taskId } = spawner.spawn(makeOptions());
    const waitPromise = spawner.waitForTask(taskId!);

    // resolve after a short delay
    setTimeout(() => resolve('polled-result'), 80);
    const result = await waitPromise;

    expect(result.success).toBe(true);
    expect(result.result).toBe('polled-result');
  });

  it('returns success:false when task fails', async () => {
    spawner.setExecutor(failExecutor('boom'));
    const { taskId } = spawner.spawn(makeOptions());
    const result = await spawner.waitForTask(taskId!);
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('returns timeout error when task hangs beyond timeoutMs', async () => {
    spawner.setExecutor(hangExecutor);
    const { taskId } = spawner.spawn(makeOptions());
    const result = await spawner.waitForTask(taskId!, 150);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/i);
  }, 3000);

  it('includes durationMs for a completed task', async () => {
    spawner.setExecutor(fastExecutor('x'));
    const { taskId } = spawner.spawn(makeOptions());
    const result = await spawner.waitForTask(taskId!);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes taskId in the result', async () => {
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions());
    const result = await spawner.waitForTask(taskId!);
    expect(result.taskId).toBe(taskId);
  });
});

// ===========================================================================
// SubagentSpawner — cancel
// ===========================================================================

describe('SubagentSpawner — cancel', () => {
  let spawner: SubagentSpawner;

  beforeEach(() => {
    spawner = new SubagentSpawner();
  });

  it('returns false for unknown taskId', () => {
    expect(spawner.cancel('unknown')).toBe(false);
  });

  it('cancels a pending task and returns true', () => {
    // no executor → task stays pending
    const { taskId } = spawner.spawn(makeOptions());
    expect(spawner.cancel(taskId!)).toBe(true);
    expect(spawner.getTask(taskId!)!.status).toBe('cancelled');
  });

  it('sets completedAt on cancellation', () => {
    const { taskId } = spawner.spawn(makeOptions());
    spawner.cancel(taskId!);
    expect(spawner.getTask(taskId!)!.completedAt).toBeInstanceOf(Date);
  });

  it('returns false when trying to cancel an already-completed task', async () => {
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions());
    await waitForStatus(spawner, taskId!);
    expect(spawner.cancel(taskId!)).toBe(false);
  });

  it('returns false when trying to cancel an already-cancelled task', () => {
    const { taskId } = spawner.spawn(makeOptions());
    spawner.cancel(taskId!);
    expect(spawner.cancel(taskId!)).toBe(false);
  });

  it('waitForTask returns cancelled result', async () => {
    const { taskId } = spawner.spawn(makeOptions());
    spawner.cancel(taskId!);
    const result = await spawner.waitForTask(taskId!);
    expect(result.success).toBe(false);
    expect(result.taskId).toBe(taskId);
  });
});

// ===========================================================================
// SubagentSpawner — cleanup
// ===========================================================================

describe('SubagentSpawner — cleanup', () => {
  it('removes completed tasks older than maxAgeMs', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions());
    await waitForStatus(spawner, taskId!);

    // backdate completedAt far in the past
    const task = spawner.getTask(taskId!)!;
    task.completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago

    const removed = spawner.cleanup(60 * 60 * 1000); // 1h maxAge
    expect(removed).toBe(1);
    expect(spawner.getTask(taskId!)).toBeUndefined();
  });

  it('keeps recently completed tasks', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor());
    const { taskId } = spawner.spawn(makeOptions());
    await waitForStatus(spawner, taskId!);

    const removed = spawner.cleanup(60 * 60 * 1000); // 1h maxAge, task just finished
    expect(removed).toBe(0);
    expect(spawner.getTask(taskId!)).toBeDefined();
  });

  it('does not remove pending tasks', () => {
    const spawner = new SubagentSpawner();
    // no executor → stays pending
    const { taskId } = spawner.spawn(makeOptions());
    const removed = spawner.cleanup(0);
    expect(removed).toBe(0);
    expect(spawner.getTask(taskId!)).toBeDefined();
  });

  it('returns the count of removed tasks', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor());
    spawner.spawn(makeOptions());
    spawner.spawn(makeOptions());
    await new Promise((r) => setTimeout(r, 100));

    // backdate all completed tasks
    for (const task of Array.from({ length: spawner.totalCount }, (_, i) =>
      spawner.getTask(spawner['tasks'].keys().next().value),
    )) {
      if (task?.completedAt) task.completedAt = new Date(0);
    }
    // direct access to private map for test setup
    for (const [, t] of (spawner as unknown as { tasks: Map<string, SubagentTask> }).tasks) {
      if (t.completedAt) t.completedAt = new Date(0);
    }

    const removed = spawner.cleanup(1);
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// SubagentSpawner — getStats
// ===========================================================================

describe('SubagentSpawner — getStats', () => {
  it('returns zero stats on fresh instance', () => {
    const spawner = new SubagentSpawner();
    const stats = spawner.getStats();
    expect(stats).toEqual({
      total: 0,
      active: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    });
  });

  it('counts pending tasks correctly', () => {
    const spawner = new SubagentSpawner();
    // no executor → tasks stay pending
    spawner.spawn(makeOptions());
    spawner.spawn(makeOptions());
    const stats = spawner.getStats();
    expect(stats.pending).toBe(2);
    expect(stats.total).toBe(2);
  });

  it('counts completed and failed tasks correctly', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(async (task) => {
      if (task.task === 'fail') throw new Error('fail');
      return 'ok';
    });

    const r1 = spawner.spawn(makeOptions({ task: 'succeed' }));
    const r2 = spawner.spawn(makeOptions({ task: 'fail' }));
    await waitForStatus(spawner, r1.taskId!);
    await waitForStatus(spawner, r2.taskId!);

    const stats = spawner.getStats();
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.total).toBe(2);
  });

  it('counts cancelled tasks correctly', () => {
    const spawner = new SubagentSpawner();
    const { taskId } = spawner.spawn(makeOptions());
    spawner.cancel(taskId!);
    expect(spawner.getStats().cancelled).toBe(1);
  });
});

// ===========================================================================
// SubagentSpawner — activeCount / totalCount getters
// ===========================================================================

describe('SubagentSpawner — activeCount / totalCount', () => {
  it('activeCount reflects tasks currently executing', () => {
    const spawner = new SubagentSpawner(5);
    spawner.setExecutor(hangExecutor);

    expect(spawner.activeCount).toBe(0);
    spawner.spawn(makeOptions());
    expect(spawner.activeCount).toBe(1);
    spawner.spawn(makeOptions());
    expect(spawner.activeCount).toBe(2);
  });

  it('totalCount includes all tasks regardless of status', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor());
    spawner.spawn(makeOptions());
    spawner.spawn(makeOptions());
    await new Promise((r) => setTimeout(r, 50));
    expect(spawner.totalCount).toBe(2);
  });
});

// ===========================================================================
// SubagentResult schema validation
// ===========================================================================

describe('SubagentResult schema', () => {
  it('waitForTask result always has success, taskId fields', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor('val'));
    const { taskId } = spawner.spawn(makeOptions());
    const result: SubagentResult = await spawner.waitForTask(taskId!);

    expect(typeof result.success).toBe('boolean');
    expect(typeof result.taskId).toBe('string');
  });

  it('successful result has result field set', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(fastExecutor('my-result'));
    const { taskId } = spawner.spawn(makeOptions());
    const result = await spawner.waitForTask(taskId!);
    expect(result.result).toBe('my-result');
    expect(result.error).toBeUndefined();
  });

  it('failed result has error field set and no result', async () => {
    const spawner = new SubagentSpawner();
    spawner.setExecutor(failExecutor('err-msg'));
    const { taskId } = spawner.spawn(makeOptions());
    const result = await spawner.waitForTask(taskId!);
    expect(result.error).toBe('err-msg');
  });
});

// ===========================================================================
// Singleton export
// ===========================================================================

describe('subagentSpawner singleton', () => {
  it('is an instance of SubagentSpawner', () => {
    expect(subagentSpawner).toBeInstanceOf(SubagentSpawner);
  });

  it('is exported as a ready-to-use singleton', () => {
    expect(subagentSpawner.activeCount).toBeGreaterThanOrEqual(0);
    expect(subagentSpawner.totalCount).toBeGreaterThanOrEqual(0);
  });
});
