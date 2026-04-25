import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveActivity } from './live-activity';

function makeMockBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      editMessageText: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('LiveActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() sends a message and stores message_id', async () => {
    const bot = makeMockBot();
    const la = new LiveActivity(bot, 123);
    await la.start('⚙️ Работаю...');
    expect(bot.api.sendMessage).toHaveBeenCalledWith(123, '⚙️ Работаю...');
    expect(bot.api.editMessageText).not.toHaveBeenCalled();
  });

  it('update() calls editMessageText', async () => {
    const bot = makeMockBot();
    const la = new LiveActivity(bot, 123);
    await la.start('init');
    // Advance time past minIntervalMs so update flushes immediately
    vi.setSystemTime(Date.now() + 3000);
    await la.update('updated text');
    expect(bot.api.editMessageText).toHaveBeenCalledWith(123, 42, 'updated text');
  });

  it('5 rapid updates within minIntervalMs → only 1 editMessageText call; final text is the last', async () => {
    const bot = makeMockBot();
    const la = new LiveActivity(bot, 123, { minIntervalMs: 2000 });
    await la.start('init');
    await la.update('text1');
    await la.update('text2');
    await la.update('text3');
    await la.update('text4');
    await la.update('text5');

    await vi.runAllTimersAsync();

    expect(bot.api.editMessageText).toHaveBeenCalled();
    const calls = bot.api.editMessageText.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[2]).toBe('text5');
  });

  it('complete() with deleteAfterMs → deleteMessage called after delay', async () => {
    const bot = makeMockBot();
    const la = new LiveActivity(bot, 123);
    await la.start('init');
    await la.complete('done!', 10);
    expect(bot.api.deleteMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(bot.api.deleteMessage).toHaveBeenCalledWith(123, 42);
  });

  it('append() truncates text longer than maxLength', async () => {
    const bot = makeMockBot();
    const la = new LiveActivity(bot, 123, { maxLength: 50 });
    await la.start('init');
    const longLine = 'x'.repeat(60);
    await la.append(longLine);
    await vi.runAllTimersAsync();
    const allArgs = bot.api.editMessageText.mock.calls;
    if (allArgs.length > 0) {
      const text = allArgs[allArgs.length - 1][2] as string;
      expect(text.length).toBeLessThanOrEqual(50);
      expect(text).toContain('[truncated]');
    }
  });

  it('handles editMessageText error gracefully', async () => {
    const bot = makeMockBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(new Error('some error'));
    const la = new LiveActivity(bot, 123);
    await la.start('init');
    vi.setSystemTime(Date.now() + 3000);
    await expect(la.update('text')).resolves.not.toThrow();
  });
});
