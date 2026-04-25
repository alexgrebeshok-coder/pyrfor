import { describe, it, expect, vi } from 'vitest';
import {
  createCostAggregator,
  envelopeToSessionCost,
  type FCEnvelope,
  type CostTracker,
} from './pyrfor-cost-aggregate';

describe('envelopeToSessionCost', () => {
  it('extracts fields from envelope with Anthropic-style usage', () => {
    const now = vi.fn(() => 1000);
    const env: FCEnvelope = {
      status: 'success',
      model: 'claude-3-opus',
      sessionId: 'sess-123',
      costUsd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      },
      durationMs: 2500,
      filesTouched: ['a.ts', 'b.ts'],
      commandsRun: ['npm test'],
      exitCode: 0,
      raw: {},
    };

    const result = envelopeToSessionCost(env, now);

    expect(result).toEqual({
      sessionId: 'sess-123',
      model: 'claude-3-opus',
      costUsd: 0.05,
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      durationMs: 2500,
      filesTouched: 2,
      commandsRun: 1,
      status: 'success',
      startedAt: 1000,
      finishedAt: 1000,
    });
    expect(now).toHaveBeenCalledOnce();
  });

  it('extracts with OpenAI-style usage fields', () => {
    const env: FCEnvelope = {
      status: 'success',
      model: 'gpt-4',
      costUsd: 0.03,
      usage: {
        prompt_tokens: 200,
        completion_tokens: 75,
      },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    };

    const result = envelopeToSessionCost(env);

    expect(result.promptTokens).toBe(200);
    expect(result.completionTokens).toBe(75);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
  });

  it('handles missing usage and null cost', () => {
    const env: FCEnvelope = {
      status: 'error',
      costUsd: null,
      filesTouched: [],
      commandsRun: [],
      exitCode: 1,
      raw: {},
    };

    const result = envelopeToSessionCost(env);

    expect(result.costUsd).toBe(0);
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
  });

  it('handles cache tokens with alternate naming', () => {
    const env: FCEnvelope = {
      status: 'success',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 30,
        cache_creation_tokens: 15,
      },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    };

    const result = envelopeToSessionCost(env);

    expect(result.cacheReadTokens).toBe(30);
    expect(result.cacheCreationTokens).toBe(15);
  });
});

describe('createCostAggregator', () => {
  it('startTask returns unique IDs across calls', () => {
    const agg = createCostAggregator();
    const id1 = agg.startTask();
    const id2 = agg.startTask();
    const id3 = agg.startTask();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
  });

  it('startTask honors explicit ID', () => {
    const agg = createCostAggregator();
    const id = agg.startTask('my-task');

    expect(id).toBe('my-task');
  });

  it('recordFcRun aggregates correctly across multiple envelopes', () => {
    const now = vi.fn(() => 5000);
    const agg = createCostAggregator({ now });

    const taskId = agg.startTask('task-1');

    agg.recordFcRun(taskId, {
      status: 'success',
      model: 'kimi',
      costUsd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
      filesTouched: ['a.ts'],
      commandsRun: ['test'],
      exitCode: 0,
      raw: {},
    });

    agg.recordFcRun(taskId, {
      status: 'success',
      model: 'kimi',
      costUsd: 0.02,
      usage: { input_tokens: 200, output_tokens: 100 },
      filesTouched: ['b.ts', 'c.ts'],
      commandsRun: ['build', 'deploy'],
      exitCode: 0,
      raw: {},
    });

    agg.recordFcRun(taskId, {
      status: 'success',
      model: 'qwen',
      costUsd: 0.005,
      usage: { input_tokens: 50, output_tokens: 25 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    const summary = agg.getSummary(taskId)!;

    expect(summary.totals.sessions).toBe(3);
    expect(summary.totals.costUsd).toBeCloseTo(0.035, 5);
    expect(summary.totals.promptTokens).toBe(350);
    expect(summary.totals.completionTokens).toBe(175);
    expect(summary.totals.filesTouched).toBe(3);
    expect(summary.totals.commandsRun).toBe(3);

    expect(summary.byModel['kimi'].sessions).toBe(2);
    expect(summary.byModel['kimi'].costUsd).toBeCloseTo(0.03, 5);
    expect(summary.byModel['kimi'].promptTokens).toBe(300);
    expect(summary.byModel['kimi'].completionTokens).toBe(150);

    expect(summary.byModel['qwen'].sessions).toBe(1);
    expect(summary.byModel['qwen'].costUsd).toBeCloseTo(0.005, 5);
    expect(summary.byModel['qwen'].promptTokens).toBe(50);
    expect(summary.byModel['qwen'].completionTokens).toBe(25);
  });

  it('aggregates cache tokens', () => {
    const agg = createCostAggregator();
    const taskId = agg.startTask();

    agg.recordFcRun(taskId, {
      status: 'success',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    agg.recordFcRun(taskId, {
      status: 'success',
      usage: {
        input_tokens: 200,
        output_tokens: 100,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 15,
      },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    const summary = agg.getSummary(taskId)!;

    expect(summary.totals.cacheReadTokens).toBe(60);
    expect(summary.totals.cacheCreationTokens).toBe(25);
  });

  it('finishTask sets finishedAt and returns summary', () => {
    const now = vi.fn(() => 1000);
    const agg = createCostAggregator({ now });

    const taskId = agg.startTask();

    now.mockReturnValue(2000);
    agg.recordFcRun(taskId, {
      status: 'success',
      costUsd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    now.mockReturnValue(3000);
    const summary = agg.finishTask(taskId);

    expect(summary.finishedAt).toBe(3000);
    expect(summary.startedAt).toBe(1000);
    expect(summary.totals.sessions).toBe(1);
  });

  it('allows recordFcRun after finishTask', () => {
    const agg = createCostAggregator();
    const taskId = agg.startTask();

    agg.recordFcRun(taskId, {
      status: 'success',
      costUsd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    agg.finishTask(taskId);

    // Should not crash, should allow recording
    expect(() => {
      agg.recordFcRun(taskId, {
        status: 'success',
        costUsd: 0.02,
        usage: { input_tokens: 200, output_tokens: 100 },
        filesTouched: [],
        commandsRun: [],
        exitCode: 0,
        raw: {},
      });
    }).not.toThrow();

    const summary = agg.getSummary(taskId)!;
    expect(summary.totals.sessions).toBe(2);
  });

  it('getSummary returns null for unknown task', () => {
    const agg = createCostAggregator();
    const summary = agg.getSummary('nonexistent');
    expect(summary).toBeNull();
  });

  it('listTasks returns all tasks', () => {
    const agg = createCostAggregator();

    agg.startTask('task-1');
    agg.startTask('task-2');
    agg.startTask('task-3');

    const tasks = agg.listTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.taskId).sort()).toEqual(['task-1', 'task-2', 'task-3']);
  });

  it('integrates with CostTracker', () => {
    const records: any[] = [];
    const mockCostTracker: CostTracker = {
      record: vi.fn((model, prompt, completion, meta) => {
        const rec = { model, promptTokens: prompt, completionTokens: completion, meta };
        records.push(rec);
        return rec as any;
      }),
      setPricing: vi.fn(),
      addAlert: vi.fn(),
      removeAlert: vi.fn(),
      getSpend: vi.fn(),
      getTokens: vi.fn(),
      getStats: vi.fn(),
      getRecent: vi.fn(),
      clear: vi.fn(),
      save: vi.fn(),
      load: vi.fn(),
    };

    const agg = createCostAggregator({ costTracker: mockCostTracker });
    const taskId = agg.startTask('integration-test');

    agg.recordFcRun(taskId, {
      status: 'success',
      model: 'claude-opus',
      sessionId: 'sess-abc',
      costUsd: 0.05,
      usage: { input_tokens: 500, output_tokens: 250 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    agg.recordFcRun(taskId, {
      status: 'success',
      model: 'gpt-4',
      sessionId: 'sess-def',
      costUsd: 0.03,
      usage: { input_tokens: 300, output_tokens: 150 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    expect(mockCostTracker.record).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      model: 'claude-opus',
      promptTokens: 500,
      completionTokens: 250,
      meta: { sessionId: 'sess-abc', taskId: 'integration-test', source: 'fc' },
    });

    expect(records[1]).toMatchObject({
      model: 'gpt-4',
      promptTokens: 300,
      completionTokens: 150,
      meta: { sessionId: 'sess-def', taskId: 'integration-test', source: 'fc' },
    });
  });

  it('recordFcRun on unknown taskId throws clear error', () => {
    const agg = createCostAggregator();

    expect(() => {
      agg.recordFcRun('unknown-task', {
        status: 'success',
        filesTouched: [],
        commandsRun: [],
        exitCode: 0,
        raw: {},
      });
    }).toThrow('Task not found: unknown-task');
  });

  it('finishTask on unknown taskId throws clear error', () => {
    const agg = createCostAggregator();

    expect(() => {
      agg.finishTask('unknown-task');
    }).toThrow('Task not found: unknown-task');
  });

  it('handles model-less envelopes with "unknown" model', () => {
    const agg = createCostAggregator();
    const taskId = agg.startTask();

    agg.recordFcRun(taskId, {
      status: 'success',
      costUsd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    const summary = agg.getSummary(taskId)!;
    expect(summary.byModel['unknown']).toBeDefined();
    expect(summary.byModel['unknown'].sessions).toBe(1);
  });

  it('aggregates durationMs', () => {
    const agg = createCostAggregator();
    const taskId = agg.startTask();

    agg.recordFcRun(taskId, {
      status: 'success',
      durationMs: 1500,
      usage: { input_tokens: 100, output_tokens: 50 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    agg.recordFcRun(taskId, {
      status: 'success',
      durationMs: 2500,
      usage: { input_tokens: 200, output_tokens: 100 },
      filesTouched: [],
      commandsRun: [],
      exitCode: 0,
      raw: {},
    });

    const summary = agg.getSummary(taskId)!;
    expect(summary.totals.durationMs).toBe(4000);
  });
});
