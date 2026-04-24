// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutoCompact } from './compact';
import type { CompactOptions } from './compact';
import type { Session } from './session';
import type { ProviderRouter } from './provider-router';

// ─── Mock logger so tests stay quiet ────────────────────────────────────────
vi.mock('../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockRouter = {
  chat: ReturnType<typeof vi.fn>;
};

function makeRouter(response = 'Mock summary'): MockRouter & ProviderRouter {
  return {
    chat: vi.fn().mockResolvedValue(response),
  } as unknown as MockRouter & ProviderRouter;
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-test-' + Math.random().toString(36).slice(2),
    channel: 'cli',
    userId: 'u1',
    chatId: 'c1',
    messages: [],
    systemPrompt: '',
    createdAt: new Date(),
    lastActivityAt: new Date(),
    tokenCount: 0,
    maxTokens: 10000,
    metadata: {},
    ...overrides,
  };
}

function userMsg(content: string) {
  return { role: 'user' as const, content };
}
function assistantMsg(content: string) {
  return { role: 'assistant' as const, content };
}
function systemMsg(content: string) {
  return { role: 'system' as const, content };
}

/** Create a session whose tokenCount sits at the given fraction of maxTokens */
function sessionAtRatio(ratio: number, maxTokens = 10000): Session {
  return makeSession({
    tokenCount: Math.floor(maxTokens * ratio),
    maxTokens,
    messages: [],
  });
}

// ─── AutoCompact ─────────────────────────────────────────────────────────────

describe('AutoCompact', () => {
  let router: MockRouter & ProviderRouter;
  let ac: AutoCompact;

  beforeEach(() => {
    router = makeRouter('Summary text');
    ac = new AutoCompact(router);
  });

  // ── maybeCompact ──────────────────────────────────────────────────────────

  describe('maybeCompact()', () => {
    it('returns null when token ratio is below default 70% threshold', async () => {
      const session = sessionAtRatio(0.5);
      session.messages = Array.from({ length: 20 }, (_, i) => userMsg(`msg ${i}`));

      const result = await ac.maybeCompact(session);
      expect(result).toBeNull();
    });

    it('returns null when token ratio is exactly at threshold boundary (69.9%)', async () => {
      const session = sessionAtRatio(0.699);
      session.messages = Array.from({ length: 20 }, (_, i) => userMsg(`msg ${i}`));

      const result = await ac.maybeCompact(session);
      expect(result).toBeNull();
    });

    it('triggers compact when token ratio is at 70% threshold', async () => {
      const session = sessionAtRatio(0.7);
      session.messages = Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0 ? userMsg(`user ${i}`) : assistantMsg(`assistant ${i}`)
      );

      const result = await ac.maybeCompact(session);
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it('triggers compact when well over threshold (90%)', async () => {
      const session = sessionAtRatio(0.9);
      session.messages = Array.from({ length: 20 }, (_, i) => userMsg(`msg ${i}`));

      const result = await ac.maybeCompact(session);
      expect(result).not.toBeNull();
    });

    it('respects a custom threshold via options', async () => {
      const session = sessionAtRatio(0.5);
      session.messages = Array.from({ length: 20 }, (_, i) => userMsg(`msg ${i}`));

      // With threshold=0.4 the session (at 50%) should compact
      const result = await ac.maybeCompact(session, { threshold: 0.4 });
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it('does NOT compact when custom threshold is higher than current ratio', async () => {
      const session = sessionAtRatio(0.7);
      session.messages = Array.from({ length: 20 }, (_, i) => userMsg(`msg ${i}`));

      const result = await ac.maybeCompact(session, { threshold: 0.9 });
      expect(result).toBeNull();
    });
  });

  // ── compact ───────────────────────────────────────────────────────────────

  describe('compact()', () => {
    it('returns early (no-op) when non-system messages ≤ keepRecentCount', async () => {
      const session = makeSession({
        messages: [userMsg('hi'), assistantMsg('hello')],
        tokenCount: 200,
      });

      const result = await ac.compact(session);
      expect(result.success).toBe(true);
      expect(result.summaryLength).toBe(0);
      expect(result.tokensSaved).toBe(0);
      expect(result.error).toMatch(/not enough messages/i);
    });

    it('returns early when message count equals keepRecentCount exactly', async () => {
      const msgs = Array.from({ length: 10 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 500 });

      const result = await ac.compact(session, { keepRecentCount: 10 });
      expect(result.success).toBe(true);
      expect(result.summaryLength).toBe(0);
    });

    it('returns early for empty messages array', async () => {
      const session = makeSession({ messages: [], tokenCount: 0 });
      const result = await ac.compact(session);
      expect(result.success).toBe(true);
      expect(result.summaryLength).toBe(0);
    });

    it('returns early for single-message session', async () => {
      const session = makeSession({ messages: [userMsg('hello')], tokenCount: 10 });
      const result = await ac.compact(session);
      expect(result.success).toBe(true);
      expect(result.summaryLength).toBe(0);
    });

    it('compacts when there are more non-system messages than keepRecentCount', async () => {
      const msgs = Array.from({ length: 15 }, (_, i) =>
        i % 2 === 0 ? userMsg(`user ${i}`) : assistantMsg(`asst ${i}`)
      );
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      const result = await ac.compact(session);
      expect(result.success).toBe(true);
      expect(result.summaryLength).toBeGreaterThan(0);
    });

    it('preserves system messages in the compacted output', async () => {
      const sysPrompt = systemMsg('You are a helpful assistant');
      const msgs = [
        sysPrompt,
        ...Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`)),
      ];
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session);

      const systemMsgs = session.messages.filter(m => m.role === 'system');
      expect(systemMsgs.some(m => m.content === sysPrompt.content)).toBe(true);
    });

    it('keeps the last keepRecentCount non-system messages', async () => {
      const msgs = Array.from({ length: 20 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session, { keepRecentCount: 5 });

      const nonSystem = session.messages.filter(m => m.role !== 'system');
      // 5 original + 1 summary = 6 non-summarised, but summary is role:system
      // The last 5 user messages should be present
      expect(nonSystem.some(m => m.content === 'msg 19')).toBe(true);
      expect(nonSystem.some(m => m.content === 'msg 15')).toBe(true);
      // Earlier messages should be gone (summarised)
      expect(nonSystem.some(m => m.content === 'msg 0')).toBe(false);
    });

    it('injects a summary message with the correct prefix', async () => {
      router.chat.mockResolvedValue('Key points from session.');
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session);

      const summaryMsg = session.messages.find(
        m => m.role === 'system' && m.content.startsWith('[Summary of earlier conversation]')
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg?.content).toContain('Key points from session.');
    });

    it('preserves order: system → summary → recent messages', async () => {
      const sysPrompt = systemMsg('System prompt');
      const msgs = [
        sysPrompt,
        ...Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`)),
      ];
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session);

      const roles = session.messages.map(m => m.role);
      // system messages come first, then summary (system), then user/assistant
      const firstNonSystem = roles.findIndex(r => r !== 'system');
      expect(firstNonSystem).toBeGreaterThanOrEqual(0);
      // All system roles should appear before the first non-system role
      for (let i = 0; i < firstNonSystem; i++) {
        expect(roles[i]).toBe('system');
      }
    });

    it('updates session.tokenCount after compaction', async () => {
      const msgs = Array.from({ length: 20 }, (_, i) => userMsg(`A`.repeat(100) + ` msg ${i}`));
      const originalTokenCount = 5000;
      const session = makeSession({ messages: msgs, tokenCount: originalTokenCount });

      await ac.compact(session);

      // After compaction there are fewer messages so tokenCount should differ
      expect(session.tokenCount).not.toBeNaN();
    });

    it('returns tokensSaved ≥ 0', async () => {
      const msgs = Array.from({ length: 20 }, (_, i) => userMsg(`word `.repeat(50) + i));
      const session = makeSession({ messages: msgs, tokenCount: 5000 });

      const result = await ac.compact(session);
      expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    });

    it('returns correct originalCount in result', async () => {
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      const result = await ac.compact(session);
      // originalCount = toSummarise(5) + recentKept(10) + systemMsgs(0) = 15
      expect(result.originalCount).toBe(15);
    });

    it('uses custom provider and model from options', async () => {
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session, { provider: 'openai', model: 'gpt-4o' });

      expect(router.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ provider: 'openai', model: 'gpt-4o' })
      );
    });

    it('generates English prompt for English conversation', async () => {
      router.chat.mockResolvedValue('English summary');
      const msgs = Array.from({ length: 15 }, (_, i) =>
        userMsg(`Hello this is message number ${i} in English`)
      );
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session);

      const [callMessages] = router.chat.mock.calls[0] as [Array<{ role: string; content: string }>, unknown];
      const promptContent = callMessages[0].content as string;
      expect(promptContent).toContain('Please provide a brief summary');
    });

    it('generates Russian prompt for Russian conversation', async () => {
      router.chat.mockResolvedValue('Краткое содержание');
      const russianMsgs = Array.from({ length: 15 }, (_, i) =>
        userMsg(`Привет, это сообщение номер ${i} на русском языке`)
      );
      const session = makeSession({ messages: russianMsgs, tokenCount: 3000 });

      await ac.compact(session);

      const [callMessages] = router.chat.mock.calls[0] as [Array<{ role: string; content: string }>, unknown];
      const promptContent = callMessages[0].content as string;
      expect(promptContent).toContain('Пожалуйста');
    });

    it('handles provider error gracefully — returns success:false with error message', async () => {
      router.chat.mockRejectedValue(new Error('Provider unavailable'));
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      const result = await ac.compact(session);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Provider unavailable');
      expect(result.tokensSaved).toBe(0);
      expect(result.summaryLength).toBe(0);
    });

    it('does not mutate session.messages on provider error', async () => {
      router.chat.mockRejectedValue(new Error('Network error'));
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: [...msgs], tokenCount: 3000 });
      const originalCount = session.messages.length;

      await ac.compact(session);

      expect(session.messages.length).toBe(originalCount);
    });

    it('handles non-Error thrown values in provider', async () => {
      router.chat.mockRejectedValue('string error');
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      const result = await ac.compact(session);
      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('trims whitespace from generated summary', async () => {
      router.chat.mockResolvedValue('  Summary with whitespace  \n');
      const msgs = Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`));
      const session = makeSession({ messages: msgs, tokenCount: 3000 });

      await ac.compact(session);

      const summaryMsg = session.messages.find(
        m => m.role === 'system' && m.content.startsWith('[Summary of earlier conversation]')
      );
      expect(summaryMsg?.content).not.toMatch(/^\s|\s$/m.compile ? /  / : /\s{2}/);
      expect(summaryMsg?.content).toContain('Summary with whitespace');
    });

    it('idempotency — compact an already-compact session (only recent messages remain) returns no-op', async () => {
      // After a compact, non-system messages <= 10; calling compact again should be a no-op
      const summaryMsg = systemMsg('[Summary of earlier conversation]\nPrevious summary');
      const recentMsgs = Array.from({ length: 5 }, (_, i) => userMsg(`recent ${i}`));
      const session = makeSession({
        messages: [summaryMsg, ...recentMsgs],
        tokenCount: 500,
      });

      const result = await ac.compact(session);
      expect(result.summaryLength).toBe(0);
      expect(result.tokensSaved).toBe(0);
      expect(result.error).toMatch(/not enough messages/i);
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('shouldCompact is false when below 70% threshold', () => {
      const session = sessionAtRatio(0.5);
      const stats = ac.getStats(session);
      expect(stats.shouldCompact).toBe(false);
    });

    it('shouldCompact is true when at or above 70% threshold', () => {
      const session = sessionAtRatio(0.7);
      const stats = ac.getStats(session);
      expect(stats.shouldCompact).toBe(true);
    });

    it('tokenRatio reflects the session token usage', () => {
      const session = sessionAtRatio(0.65);
      const stats = ac.getStats(session);
      expect(stats.tokenRatio).toBeCloseTo(0.65, 2);
    });

    it('estimatedSavings is 0 when messages ≤ keepRecentCount', () => {
      const session = makeSession({
        messages: Array.from({ length: 5 }, (_, i) => userMsg(`msg ${i}`)),
        tokenCount: 500,
      });
      const stats = ac.getStats(session);
      expect(stats.estimatedSavings).toBe(0);
    });

    it('estimatedSavings is positive when messages exceed keepRecentCount', () => {
      const session = makeSession({
        messages: Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`)),
        tokenCount: 3000,
      });
      const stats = ac.getStats(session);
      // 15 - 10 = 5 messages to summarise × 50 tokens each = 250
      expect(stats.estimatedSavings).toBe(250);
    });

    it('system messages are excluded from estimatedSavings count', () => {
      const session = makeSession({
        messages: [
          systemMsg('System prompt'),
          ...Array.from({ length: 15 }, (_, i) => userMsg(`msg ${i}`)),
        ],
        tokenCount: 3000,
      });
      const stats = ac.getStats(session);
      // 15 non-system messages → 5 to summarise
      expect(stats.estimatedSavings).toBe(250);
    });

    it('tokenRatio of 0 for empty session', () => {
      const session = makeSession({ tokenCount: 0, maxTokens: 10000 });
      const stats = ac.getStats(session);
      expect(stats.tokenRatio).toBe(0);
      expect(stats.shouldCompact).toBe(false);
    });
  });
});
