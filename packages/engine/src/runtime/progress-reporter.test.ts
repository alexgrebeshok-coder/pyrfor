// @vitest-environment node
/**
 * Tests for packages/engine/src/runtime/progress-reporter.ts
 *
 * Strategy:
 *  - vi.useFakeTimers() for debounce / typing-interval tests.
 *  - In-memory mock API tracks every call.
 *  - Await _queue via finish/cancel where we need "all enqueued tasks done".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProgressReporter,
  type ChatProgressApi,
  type ProgressReporterOptions,
} from './progress-reporter.js';

// ─── Mock API factory ─────────────────────────────────────────────────────────

function makeMockApi() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const api: ChatProgressApi = {
    async sendMessage(...a) {
      calls.push({ method: 'sendMessage', args: a });
      return { message_id: 42 };
    },
    async editMessageText(...a) {
      calls.push({ method: 'editMessageText', args: a });
      return {};
    },
    async sendChatAction(...a) {
      calls.push({ method: 'sendChatAction', args: a });
      return {};
    },
    async deleteMessage(...a) {
      calls.push({ method: 'deleteMessage', args: a });
      return {};
    },
  };
  return { api, calls };
}

function makeReporter(
  overrides: Partial<ProgressReporterOptions> & { api: ChatProgressApi },
) {
  return createProgressReporter({
    chatId: 100,
    editDebounceMs: 200,
    typingIntervalMs: 500,
    maxLength: 3500,
    ...overrides,
  });
}

// ─── Fake clock helpers ───────────────────────────────────────────────────────

/** Advance fake timers AND flush microtask queue. */
async function advanceAndFlush(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('start()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends initial sendMessage and sets messageId', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.start('Hello!');
    await advanceAndFlush(0);

    const sends = calls.filter(c => c.method === 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(sends[0].args[1]).toBe('Hello!');
    expect(r.messageId).toBe(42);
    expect(r.state).toBe('sent');
  });

  it('second start() call is a no-op', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.start('First');
    await advanceAndFlush(0);
    await r.start('Second');
    await advanceAndFlush(0);

    expect(calls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
  });

  it('sets state to sent after start', async () => {
    const { api } = makeMockApi();
    const r = makeReporter({ api });
    await r.start('Hi');
    expect(r.state).toBe('sent');
  });
});

describe('update()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('auto-calls start() when state is idle', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.update('First update');
    await advanceAndFlush(0);

    expect(calls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
    expect(r.state).toBe('sent');
  });

  it('debounces rapid updates into a single editMessageText with the latest text', async () => {
    const { api, calls } = makeMockApi();
    // Use controllable now()
    let fakeNow = 0;
    const r = makeReporter({ api, editDebounceMs: 200, now: () => fakeNow });

    await r.start('Initial');
    await advanceAndFlush(0); // flush sendMessage

    // Rapid-fire 3 updates within the debounce window
    await r.update('update-1');
    await r.update('update-2');
    await r.update('update-3');

    // Advance past debounce
    await advanceAndFlush(300);

    const edits = calls.filter(c => c.method === 'editMessageText');
    expect(edits).toHaveLength(1);
    expect(edits[0].args[2]).toBe('update-3');
  });

  it('skips edit when new text equals last-sent text', async () => {
    const { api, calls } = makeMockApi();
    let fakeNow = 0;
    const r = makeReporter({ api, editDebounceMs: 0, now: () => fakeNow });

    await r.start('Same text');
    await advanceAndFlush(0);

    // Force lastEditAt far in the past so debounce delay is 0
    fakeNow = 10_000;

    await r.update('Same text');
    await advanceAndFlush(50);

    expect(calls.filter(c => c.method === 'editMessageText')).toHaveLength(0);
  });

  it('truncates text exceeding maxLength with "…" suffix', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, maxLength: 10, editDebounceMs: 0 });

    await r.start('Short');
    await advanceAndFlush(0);

    // Reset lastEditAt via fake now
    const r2 = createProgressReporter({
      api,
      chatId: 100,
      maxLength: 10,
      editDebounceMs: 0,
      now: () => 100_000,
    });
    await r2.start('Short');
    await advanceAndFlush(0);
    await r2.update('A'.repeat(20));
    await advanceAndFlush(50);

    const edits = calls.filter(c => c.method === 'editMessageText');
    const lastEdit = edits[edits.length - 1];
    expect((lastEdit.args[2] as string).length).toBe(10);
    expect((lastEdit.args[2] as string).endsWith('…')).toBe(true);
  });

  it('is a no-op after finish', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, editDebounceMs: 0 });

    await r.start('Hi');
    await advanceAndFlush(0);
    await r.finish('Done');

    const editsBefore = calls.filter(c => c.method === 'editMessageText').length;
    await r.update('Should be ignored');
    await advanceAndFlush(300);

    expect(calls.filter(c => c.method === 'editMessageText').length).toBe(editsBefore);
  });
});

describe('finish()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes pending debounced edit with final text, sets state finished', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, editDebounceMs: 500 });

    await r.start('Working…');
    await advanceAndFlush(0);
    void r.update('Pending update');
    // finish before debounce fires
    await r.finish('All done!');

    expect(r.state).toBe('finished');
    const edits = calls.filter(c => c.method === 'editMessageText');
    expect(edits[edits.length - 1].args[2]).toBe('All done!');
  });

  it('stops typing loop on finish', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, typingIntervalMs: 100 });

    await r.start('Hi');
    await advanceAndFlush(0);

    await r.finish('Done');

    const typingCountAfterFinish = calls.filter(c => c.method === 'sendChatAction').length;

    // Advance more time — no new typing actions should arrive
    await advanceAndFlush(500);

    expect(calls.filter(c => c.method === 'sendChatAction').length).toBe(typingCountAfterFinish);
  });

  it('sends fresh sendMessage if state was idle (never started)', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.finish('Immediate finish');
    await advanceAndFlush(0);

    expect(calls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
    expect(r.state).toBe('finished');
  });

  it('further start/update calls after finish are no-ops', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.start('Hi');
    await advanceAndFlush(0);
    await r.finish('Done');

    await r.start('Should be ignored');
    await r.update('Also ignored');
    await advanceAndFlush(300);

    const sends = calls.filter(c => c.method === 'sendMessage');
    expect(sends).toHaveLength(1); // only the original start
  });
});

describe('fail()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('prefixes message with ❌  and sets state failed', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.start('Working');
    await advanceAndFlush(0);
    await r.fail('Something went wrong');

    expect(r.state).toBe('failed');
    const edits = calls.filter(c => c.method === 'editMessageText');
    expect(edits[edits.length - 1].args[2]).toBe('❌ Something went wrong');
  });

  it('fail on idle sends a fresh sendMessage with ❌ prefix', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.fail('Oops');
    await advanceAndFlush(0);

    const sends = calls.filter(c => c.method === 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(sends[0].args[1]).toBe('❌ Oops');
    expect(r.state).toBe('failed');
  });
});

describe('cancel()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops typing loop and cancels pending edit without sending anything', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, editDebounceMs: 500, typingIntervalMs: 100 });

    await r.start('Hi');
    await advanceAndFlush(0);
    void r.update('Pending');
    await r.cancel();

    const callCountAtCancel = calls.length;
    await advanceAndFlush(1000);

    // No additional edit or sendChatAction after cancel
    const edits = calls.filter(c => c.method === 'editMessageText');
    expect(edits).toHaveLength(0);
    expect(calls.length).toBe(callCountAtCancel);
    expect(r.state).toBe('cancelled');
  });

  it('further calls after cancel are no-ops', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api });

    await r.start('Hi');
    await advanceAndFlush(0);
    await r.cancel();

    const before = calls.length;
    await r.update('ignored');
    await r.finish('ignored');
    await advanceAndFlush(300);

    expect(calls.length).toBe(before);
  });
});

describe('typing action', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends sendChatAction(typing) at configured intervals', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, typingIntervalMs: 300, editDebounceMs: 100 });

    await r.start('Hi');
    await advanceAndFlush(0); // initial fire

    const countAfterStart = calls.filter(c => c.method === 'sendChatAction').length;
    expect(countAfterStart).toBeGreaterThanOrEqual(1);

    await advanceAndFlush(900); // ~3 more interval fires
    const countAfterWait = calls.filter(c => c.method === 'sendChatAction').length;
    expect(countAfterWait).toBeGreaterThan(countAfterStart);
  });

  it('typing stopped after finish (no new actions)', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, typingIntervalMs: 100 });

    await r.start('Hi');
    await advanceAndFlush(0);
    await r.finish('Done');

    const after = calls.filter(c => c.method === 'sendChatAction').length;
    await advanceAndFlush(500);
    expect(calls.filter(c => c.method === 'sendChatAction').length).toBe(after);
  });

  it('typingIntervalMs=0 disables typing loop', async () => {
    const { api, calls } = makeMockApi();
    const r = makeReporter({ api, typingIntervalMs: 0 });

    await r.start('Hi');
    await advanceAndFlush(2000);

    expect(calls.filter(c => c.method === 'sendChatAction')).toHaveLength(0);
  });
});

describe('rate-limit retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries editMessageText once on 429, then succeeds', async () => {
    let attempt = 0;
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const api: ChatProgressApi = {
      async sendMessage(...a) {
        calls.push({ method: 'sendMessage', args: a });
        return { message_id: 42 };
      },
      async editMessageText(...a) {
        calls.push({ method: 'editMessageText', args: a });
        attempt++;
        if (attempt === 1) {
          throw { error_code: 429, parameters: { retry_after: 0.01 } };
        }
        return {};
      },
      async sendChatAction(...a) {
        calls.push({ method: 'sendChatAction', args: a });
        return {};
      },
    };

    const r = makeReporter({ api, typingIntervalMs: 0 });
    await r.start('Hi');
    await advanceAndFlush(0);

    // Trigger finish which calls editMessageText
    const finishPromise = r.finish('Done');
    // Advance past the retry_after delay (0.01s → 10ms)
    await advanceAndFlush(200);
    await finishPromise;

    const edits = calls.filter(c => c.method === 'editMessageText');
    expect(edits).toHaveLength(2); // first attempt + retry
    expect(r.state).toBe('finished');
  });
});

describe('error swallowing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('non-429 edit failure is swallowed, state remains intact', async () => {
    const api: ChatProgressApi = {
      async sendMessage() { return { message_id: 42 }; },
      async editMessageText() { throw new Error('Network error'); },
      async sendChatAction() { return {}; },
    };

    const logEntries: string[] = [];
    const r = createProgressReporter({
      api,
      chatId: 100,
      typingIntervalMs: 0,
      editDebounceMs: 0,
      log: (msg) => logEntries.push(msg),
    });

    await r.start('Hi');
    await advanceAndFlush(0);

    await expect(r.finish('Done')).resolves.not.toThrow();
    expect(r.state).toBe('finished');
    expect(logEntries.some(e => e.includes('error'))).toBe(true);
  });
});

describe('serialisation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('concurrent updates are serialised — no overlapping editMessageText calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const api: ChatProgressApi = {
      async sendMessage() { return { message_id: 42 }; },
      async editMessageText(..._a) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        inFlight--;
        return {};
      },
      async sendChatAction() { return {}; },
    };

    let fakeNow = 100_000;
    const r = createProgressReporter({
      api,
      chatId: 100,
      editDebounceMs: 0,
      typingIntervalMs: 0,
      now: () => fakeNow,
    });

    await r.start('Hi');
    await advanceAndFlush(0);

    // Enqueue two edits in quick succession; debounce=0 so both fire
    fakeNow += 10_000; // push past debounce
    await r.update('update-A');
    await advanceAndFlush(10); // fire first debounce timer
    fakeNow += 10_000;
    await r.update('update-B');
    await advanceAndFlush(10); // fire second debounce timer

    // Let both edits resolve
    await advanceAndFlush(300);

    expect(maxInFlight).toBeLessThanOrEqual(1);
  });
});

describe('maxLength edge cases', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('maxLength=0 → text is always replaced with "…"', async () => {
    const { api, calls } = makeMockApi();
    const r = createProgressReporter({
      api,
      chatId: 100,
      maxLength: 0,
      typingIntervalMs: 0,
      editDebounceMs: 0,
    });

    await r.start('Hello world');
    await advanceAndFlush(0);

    const sends = calls.filter(c => c.method === 'sendMessage');
    expect(sends[0].args[1]).toBe('…');
  });
});

describe('custom logger', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('receives log entries on sendMessage and editMessageText', async () => {
    const { api } = makeMockApi();
    const logSpy = vi.fn();

    const r = createProgressReporter({
      api,
      chatId: 100,
      typingIntervalMs: 0,
      editDebounceMs: 0,
      log: logSpy,
      now: () => 100_000,
    });

    await r.start('Hi');
    await advanceAndFlush(0);
    await r.finish('Done');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('sendMessage'),
      expect.any(Object),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('editMessageText'),
      expect.any(Object),
    );
  });

  it('receives log entry on non-429 api error', async () => {
    const api: ChatProgressApi = {
      async sendMessage() { return { message_id: 42 }; },
      async editMessageText() { throw new Error('Bang'); },
      async sendChatAction() { return {}; },
    };
    const logSpy = vi.fn();
    const r = createProgressReporter({
      api,
      chatId: 100,
      typingIntervalMs: 0,
      editDebounceMs: 0,
      log: logSpy,
    });

    await r.start('Hi');
    await advanceAndFlush(0);
    await r.finish('Done');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('error'),
      expect.any(Object),
    );
  });
});
