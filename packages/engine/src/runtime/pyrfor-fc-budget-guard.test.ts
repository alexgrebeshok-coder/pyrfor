// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runFreeClaudeWithBudget } from './pyrfor-fc-budget-guard';
import type { FcBudgetGuardOptions } from './pyrfor-fc-budget-guard';
import type { FCHandle, FCEnvelope, FCRunResult } from './pyrfor-fc-adapter';
import type { TokenBudgetController } from './token-budget-controller';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<FCEnvelope> = {}): FCEnvelope {
  return {
    status: 'success',
    exitCode: 0,
    filesTouched: [],
    commandsRun: [],
    raw: {},
    ...overrides,
  };
}

function makeHandle(envelope: Partial<FCEnvelope> = {}): { handle: FCHandle; abortMock: ReturnType<typeof vi.fn> } {
  const abortMock = vi.fn();
  const fullEnvelope = makeEnvelope(envelope);
  const handle: FCHandle = {
    async *events() {},
    async complete(): Promise<FCRunResult> {
      return { envelope: fullEnvelope, events: [], exitCode: fullEnvelope.exitCode };
    },
    abort: abortMock,
  };
  return { handle, abortMock };
}

/** A handle whose complete() resolves after a delay (to let intervals fire first). */
function makeSlowHandle(
  envelope: Partial<FCEnvelope> = {},
  delayMs = 200,
): { handle: FCHandle; abortMock: ReturnType<typeof vi.fn> } {
  const abortMock = vi.fn();
  const fullEnvelope = makeEnvelope(envelope);
  const handle: FCHandle = {
    async *events() {},
    async complete(): Promise<FCRunResult> {
      await new Promise<void>((r) => setTimeout(r, delayMs));
      return { envelope: fullEnvelope, events: [], exitCode: fullEnvelope.exitCode };
    },
    abort: abortMock,
  };
  return { handle, abortMock };
}

type MockController = TokenBudgetController & {
  canConsumeMock: ReturnType<typeof vi.fn>;
  recordConsumptionMock: ReturnType<typeof vi.fn>;
};

function makeController(overrides: Partial<TokenBudgetController> = {}): MockController {
  const canConsumeMock = vi.fn().mockReturnValue({ allowed: true });
  const recordConsumptionMock = vi.fn().mockReturnValue({ warnings: [] });

  return {
    addRule: vi.fn(),
    removeRule: vi.fn(),
    listRules: vi.fn().mockReturnValue([]),
    canConsume: canConsumeMock,
    recordConsumption: recordConsumptionMock,
    usageFor: vi.fn(),
    reportSnapshot: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
    canConsumeMock,
    recordConsumptionMock,
    ...overrides,
  } as unknown as MockController;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runFreeClaudeWithBudget', () => {
  it('1. pre-check allowed → FC spawned, recordConsumption called with real tokens', async () => {
    const controller = makeController();
    const { handle } = makeHandle({
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const runFn = vi.fn().mockReturnValue(handle);

    const envelope = await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'task', runFn, checkIntervalMs: 0 },
    );

    expect(runFn).toHaveBeenCalledOnce();
    expect(envelope.status).toBe('success');
    expect(controller.recordConsumptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 100, completionTokens: 50 }),
    );
  });

  it('2. pre-check denied → runFn not called, returns error envelope with reason', async () => {
    const controller = makeController();
    controller.canConsumeMock.mockReturnValue({ allowed: false, blockingRule: 'daily-limit' });
    const runFn = vi.fn();

    const envelope = await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'task', runFn },
    );

    expect(runFn).not.toHaveBeenCalled();
    expect(envelope.status).toBe('error');
    expect(envelope.error).toMatch(/budget denied/);
    expect(envelope.error).toContain('daily-limit');
  });

  it('3. periodic check denied mid-run → handle.abort called, returns error envelope', async () => {
    const controller = makeController();
    // Pre-check passes; subsequent calls (periodic) fail
    controller.canConsumeMock
      .mockReturnValueOnce({ allowed: true })
      .mockReturnValue({ allowed: false, blockingRule: 'hour-limit' });

    const { handle, abortMock } = makeSlowHandle({ status: 'error', error: 'Aborted: budget exhausted' }, 300);
    const runFn = vi.fn().mockReturnValue(handle);

    const envelope = await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'task', runFn, checkIntervalMs: 50 },
    );

    expect(abortMock).toHaveBeenCalledWith('budget exhausted');
    expect(envelope.status).toBe('error');
    expect(envelope.error).toMatch(/budget exhausted/);
  });

  it('4. checkIntervalMs=0 → no periodic checks (canConsume called exactly twice: pre + final)', async () => {
    const controller = makeController();
    const { handle } = makeHandle({ usage: { input_tokens: 10, output_tokens: 5 } });
    const runFn = vi.fn().mockReturnValue(handle);

    await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'session', runFn, checkIntervalMs: 0 },
    );

    // pre-check + final-check = 2 (no periodic)
    expect(controller.canConsumeMock).toHaveBeenCalledTimes(2);
  });

  it('5. recordConsumption called with envelope.usage.input_tokens/output_tokens', async () => {
    const controller = makeController();
    const { handle } = makeHandle({
      usage: { input_tokens: 1234, output_tokens: 567 },
      costUsd: 0.05,
    });
    const runFn = vi.fn().mockReturnValue(handle);

    await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'global', runFn, checkIntervalMs: 0 },
    );

    expect(controller.recordConsumptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTokens: 1234,
        completionTokens: 567,
        costUsd: 0.05,
        scope: 'global',
      }),
    );
  });

  it('6. recordConsumption tolerates missing usage (uses 0/0)', async () => {
    const controller = makeController();
    const { handle } = makeHandle({ usage: undefined });
    const runFn = vi.fn().mockReturnValue(handle);

    await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'task', runFn, checkIntervalMs: 0 },
    );

    expect(controller.recordConsumptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 0, completionTokens: 0 }),
    );
  });

  it('7. onBudgetAbort callback fired on mid-run abort', async () => {
    const controller = makeController();
    controller.canConsumeMock
      .mockReturnValueOnce({ allowed: true })
      .mockReturnValue({ allowed: false, blockingRule: 'month-limit' });

    const { handle } = makeSlowHandle({}, 300);
    const runFn = vi.fn().mockReturnValue(handle);
    const onBudgetAbort = vi.fn();

    await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'task', runFn, checkIntervalMs: 50, onBudgetAbort },
    );

    expect(onBudgetAbort).toHaveBeenCalledOnce();
    expect(onBudgetAbort).toHaveBeenCalledWith(
      expect.stringContaining('budget exhausted'),
    );
  });

  it('8. logger receives info messages on successful run', async () => {
    const controller = makeController();
    const { handle } = makeHandle();
    const runFn = vi.fn().mockReturnValue(handle);
    const logger = vi.fn();

    await runFreeClaudeWithBudget(
      { prompt: 'test' },
      { controller, scope: 'task', runFn, checkIntervalMs: 0, logger },
    );

    const infoCalls = logger.mock.calls.filter(([level]) => level === 'info');
    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
  });
});
