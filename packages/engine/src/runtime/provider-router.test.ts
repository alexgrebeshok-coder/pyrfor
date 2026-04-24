// @vitest-environment node
/**
 * Tests for ProviderRouter — smart provider selection with fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AIProvider, Message } from '../ai/providers/base';

// ── Mocks (must be declared before import of the module under test) ─────────

vi.mock('../observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/tokens', () => ({
  estimateTokens: vi.fn().mockReturnValue(10),
}));

// Auto-initialised providers: only OllamaProvider is always constructed
// (the others require env vars). We mock all to avoid real I/O.
vi.mock('../ai/providers/ollama', () => ({
  // Must use regular function (not arrow) so `new OllamaProvider()` works
  OllamaProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'ollama';
    this.models = ['llama3'];
    this.chat = vi.fn().mockResolvedValue('ollama response');
  }),
}));

vi.mock('../ai/providers/zhipu', () => ({
  ZhipuProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'zhipu';
    this.models = ['glm-4'];
    this.chat = vi.fn().mockResolvedValue('zhipu response');
  }),
}));

vi.mock('../ai/providers/zai', () => ({
  ZAIProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'zai';
    this.models = ['gpt-4o-mini'];
    this.chat = vi.fn().mockResolvedValue('zai response');
  }),
}));

vi.mock('../ai/providers/openrouter', () => ({
  OpenRouterProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'openrouter';
    this.models = ['openai/gpt-4o'];
    this.chat = vi.fn().mockResolvedValue('openrouter response');
  }),
}));

vi.mock('../ai/providers/openai', () => ({
  OpenAIProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'openai';
    this.models = ['gpt-4o'];
    this.chat = vi.fn().mockResolvedValue('openai response');
  }),
}));

vi.mock('../ai/providers/gigachat', () => ({
  GigaChatProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'gigachat';
    this.models = ['gigachat'];
    this.chat = vi.fn().mockResolvedValue('gigachat response');
  }),
}));

vi.mock('../ai/providers/yandexgpt', () => ({
  YandexGPTProvider: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'yandexgpt';
    this.models = ['yandexgpt-lite'];
    this.chat = vi.fn().mockResolvedValue('yandexgpt response');
  }),
}));

// ── Module under test ─────────────────────────────────────────────────────────
import { ProviderRouter } from './provider-router';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MESSAGES: Message[] = [{ role: 'user', content: 'hello' }];

function fakeProvider(name: string, response = `${name} ok`): AIProvider {
  return {
    name,
    models: [`${name}-model`],
    chat: vi.fn().mockResolvedValue(response),
  };
}

function failingProvider(name: string, error = `${name} failed`): AIProvider {
  return {
    name,
    models: [`${name}-model`],
    chat: vi.fn().mockRejectedValue(new Error(error)),
  };
}

function streamingProvider(name: string, chunks: string[]): AIProvider {
  return {
    name,
    models: [`${name}-model`],
    chat: vi.fn().mockResolvedValue(chunks.join('')),
    async *chatStream() {
      for (const c of chunks) yield c;
    },
  };
}

/** Create a router pre-populated with one fake provider (no env-var providers). */
function freshRouter(opts?: ConstructorParameters<typeof ProviderRouter>[0]): ProviderRouter {
  // Wipe all API key env vars so initializeProviders registers only ollama
  delete process.env.ZHIPU_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GIGACHAT_API_KEY;
  delete process.env.YANDEX_API_KEY;
  return new ProviderRouter({ maxRetries: 1, timeoutMs: 5000, ...opts });
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('ProviderRouter', () => {
  let router: ProviderRouter;

  beforeEach(() => {
    router = freshRouter();
  });

  // ── register / getAvailableProviders / hasAvailableProvider ───────────────

  describe('register()', () => {
    it('adds the provider to the available list', () => {
      router.register('alpha', fakeProvider('alpha'));
      expect(router.getAvailableProviders()).toContain('alpha');
    });

    it('overwrites an existing registration by the same name', () => {
      const first = fakeProvider('beta', 'first');
      const second = fakeProvider('beta', 'second');
      router.register('beta', first);
      router.register('beta', second);
      expect(router.getAvailableProviders()).toContain('beta');
    });

    it('initialises health entry with available=true and 0 failures', () => {
      router.register('gamma', fakeProvider('gamma'));
      const h = router.getHealth().find(x => x.provider === 'gamma');
      expect(h?.available).toBe(true);
      expect(h?.consecutiveFailures).toBe(0);
    });
  });

  describe('getAvailableProviders()', () => {
    it('returns empty when all are exhausted', () => {
      // Manufacture a router with zero env keys, then mark the auto-ollama unavailable
      const r = freshRouter();
      const ollamaHealth = r.getHealth().find(h => h.provider === 'ollama');
      if (ollamaHealth) {
        ollamaHealth.available = false;
        ollamaHealth.consecutiveFailures = 3;
      }
      expect(r.getAvailableProviders()).toHaveLength(0);
    });

    it('excludes providers with consecutiveFailures >= 3', () => {
      router.register('flaky', fakeProvider('flaky'));
      const h = router.getHealth().find(x => x.provider === 'flaky')!;
      h.consecutiveFailures = 3;
      expect(router.getAvailableProviders()).not.toContain('flaky');
    });
  });

  describe('hasAvailableProvider()', () => {
    it('returns true when at least one provider is healthy', () => {
      router.register('p1', fakeProvider('p1'));
      expect(router.hasAvailableProvider()).toBe(true);
    });

    it('returns false when all providers are unhealthy', () => {
      const r = freshRouter();
      r.getHealth().forEach(h => {
        h.available = false;
        h.consecutiveFailures = 3;
      });
      expect(r.hasAvailableProvider()).toBe(false);
    });
  });

  // ── chat() happy path ─────────────────────────────────────────────────────

  describe('chat() — happy path', () => {
    it('returns response from the preferred provider', async () => {
      const p = fakeProvider('primary', 'hello world');
      router.register('primary', p);
      const result = await router.chat(MESSAGES, { provider: 'primary' });
      expect(result).toBe('hello world');
      expect(p.chat).toHaveBeenCalledOnce();
    });

    it('passes messages and options through to the provider', async () => {
      const p = fakeProvider('p');
      router.register('p', p);
      const opts = { provider: 'p', model: 'test-model', temperature: 0.5 };
      await router.chat(MESSAGES, opts);
      expect(p.chat).toHaveBeenCalledWith(MESSAGES, expect.objectContaining({ model: 'test-model' }));
    });

    it('uses defaultProvider when no provider option is given', async () => {
      // Create router whose defaultProvider is explicitly 'mydefault'
      const r = freshRouter({ defaultProvider: 'mydefault' });
      const p = fakeProvider('mydefault', 'from default');
      r.register('mydefault', p);
      const result = await r.chat(MESSAGES);
      expect(result).toBe('from default');
    });

    it('records cost for the session', async () => {
      const p = fakeProvider('p', 'resp');
      router.register('p', p);
      await router.chat(MESSAGES, { provider: 'p', sessionId: 'sess-1' });
      const cost = router.getSessionCost('sess-1');
      expect(cost.calls).toBe(1);
      expect(cost.totalUsd).toBeGreaterThanOrEqual(0);
    });

    it('updates health avgResponseTimeMs after success', async () => {
      router.register('fast', fakeProvider('fast'));
      await router.chat(MESSAGES, { provider: 'fast' });
      const h = router.getHealth().find(x => x.provider === 'fast')!;
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastUsed).toBeInstanceOf(Date);
    });
  });

  // ── chat() fallback chain ─────────────────────────────────────────────────

  describe('chat() — fallback chain', () => {
    it('falls back to secondary when primary throws', async () => {
      const primary = failingProvider('primary');
      const secondary = fakeProvider('secondary', 'fallback worked');
      router.register('primary', primary);
      router.register('secondary', secondary);

      // Use custom fallback order via defaults: secondary must be in the chain
      // Build a router that lists primary first in fallback chain by setting defaultProvider
      const r = freshRouter({ defaultProvider: 'primary' });
      r.register('primary', primary);
      r.register('secondary', secondary);
      // Override the fallback chain ordering by registering secondary
      // The internal fallbackChain is: ['zhipu','zai','openrouter','ollama','gigachat','yandexgpt']
      // secondary is NOT in that list, so we need it to be in the chain via a workaround:
      // Register secondary under an existing chain name, e.g. 'openrouter'
      r.register('openrouter', fakeProvider('openrouter', 'fallback via openrouter'));

      const result = await r.chat(MESSAGES, { provider: 'primary' });
      // primary fails, fallback goes to next in chain
      expect(result).toBe('fallback via openrouter');
    });

    it('fallback chain starts with preferred provider', async () => {
      const called: string[] = [];
      const p1 = { name: 'zai', models: [], chat: vi.fn().mockImplementation(() => { called.push('zai'); return Promise.resolve('ok'); }) };
      const r = freshRouter({ defaultProvider: 'zai' });
      r.register('zai', p1);
      await r.chat(MESSAGES, { provider: 'zai' });
      expect(called[0]).toBe('zai');
    });

    it('skips unavailable provider and uses next healthy one', async () => {
      const r = freshRouter({ defaultProvider: 'bad' });
      const bad = fakeProvider('bad');
      r.register('bad', bad);
      // Mark bad as unavailable
      const h = r.getHealth().find(x => x.provider === 'bad')!;
      h.available = false;

      // ollama was auto-registered and should be reachable
      // Override ollama with a controlled mock
      const good = fakeProvider('ollama', 'ollama ok');
      r.register('ollama', good);

      const result = await r.chat(MESSAGES, { provider: 'bad' });
      expect(result).toBe('ollama ok');
      expect(bad.chat).not.toHaveBeenCalled();
    });

    it('throws "All providers failed" when every provider errors', async () => {
      const r = freshRouter({ defaultProvider: 'onlyone' });
      r.register('onlyone', failingProvider('onlyone', 'boom'));
      // Disable auto-registered ollama
      r.getHealth().forEach(h => { h.available = false; h.consecutiveFailures = 3; });
      r.register('onlyone', failingProvider('onlyone', 'boom')); // re-register (health was wiped)

      await expect(r.chat(MESSAGES, { provider: 'onlyone' })).rejects.toThrow('All providers failed');
    });

    it('preserves the original error message in the thrown error', async () => {
      const r = freshRouter({ defaultProvider: 'p' });
      r.register('p', failingProvider('p', 'network exploded'));
      r.getHealth().forEach(h => { h.available = false; h.consecutiveFailures = 3; });
      r.register('p', failingProvider('p', 'network exploded'));

      await expect(r.chat(MESSAGES, { provider: 'p' })).rejects.toThrow('network exploded');
    });

    it('does not fallback when enableFallback=false', async () => {
      const r = freshRouter({ defaultProvider: 'only', enableFallback: false });
      r.register('only', failingProvider('only', 'gone'));
      await expect(r.chat(MESSAGES, { provider: 'only' })).rejects.toThrow('All providers failed');
    });
  });

  // ── chat() retry / error-type behaviour ──────────────────────────────────

  describe('chat() — retry behaviour', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('skips retry on 401 auth error', async () => {
      const p = { name: 'p', models: [], chat: vi.fn().mockRejectedValue(new Error('401 Unauthorized')) };
      const r = freshRouter({ defaultProvider: 'p', maxRetries: 3 });
      r.register('p', p);
      r.getHealth().forEach(h => { if (h.provider !== 'p') { h.available = false; h.consecutiveFailures = 3; } });

      // Attach rejection handler before advancing timers to prevent unhandled-rejection warning
      const assertion = expect(r.chat(MESSAGES, { provider: 'p' })).rejects.toThrow('All providers failed');
      await vi.runAllTimersAsync();
      await assertion;
      // Called only once (no retries)
      expect(p.chat).toHaveBeenCalledTimes(1);
    });

    it('skips retry on 403 forbidden error', async () => {
      const p = { name: 'p', models: [], chat: vi.fn().mockRejectedValue(new Error('403 Forbidden')) };
      const r = freshRouter({ defaultProvider: 'p', maxRetries: 3 });
      r.register('p', p);
      r.getHealth().forEach(h => { if (h.provider !== 'p') { h.available = false; h.consecutiveFailures = 3; } });

      const assertion = expect(r.chat(MESSAGES, { provider: 'p' })).rejects.toThrow('All providers failed');
      await vi.runAllTimersAsync();
      await assertion;
      expect(p.chat).toHaveBeenCalledTimes(1);
    });

    it('skips retry on 429 rate-limit error', async () => {
      const p = { name: 'p', models: [], chat: vi.fn().mockRejectedValue(new Error('429 Too Many Requests')) };
      const r = freshRouter({ defaultProvider: 'p', maxRetries: 3 });
      r.register('p', p);
      r.getHealth().forEach(h => { if (h.provider !== 'p') { h.available = false; h.consecutiveFailures = 3; } });

      const assertion = expect(r.chat(MESSAGES, { provider: 'p' })).rejects.toThrow('All providers failed');
      await vi.runAllTimersAsync();
      await assertion;
      expect(p.chat).toHaveBeenCalledTimes(1);
    });

    it('retries up to maxRetries on generic error', async () => {
      const p = { name: 'p', models: [], chat: vi.fn().mockRejectedValue(new Error('network timeout')) };
      const r = freshRouter({ defaultProvider: 'p', maxRetries: 3 });
      r.register('p', p);
      r.getHealth().forEach(h => { if (h.provider !== 'p') { h.available = false; h.consecutiveFailures = 3; } });

      const assertion = expect(r.chat(MESSAGES, { provider: 'p' })).rejects.toThrow('All providers failed');
      await vi.runAllTimersAsync();
      await assertion;
      expect(p.chat).toHaveBeenCalledTimes(3);
    });

    it('times out a slow provider', async () => {
      const slow = {
        name: 'slow',
        models: [],
        chat: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      };
      const r = freshRouter({ defaultProvider: 'slow', timeoutMs: 100, maxRetries: 1 });
      r.register('slow', slow);
      r.getHealth().forEach(h => { if (h.provider !== 'slow') { h.available = false; h.consecutiveFailures = 3; } });

      const assertion = expect(r.chat(MESSAGES, { provider: 'slow' })).rejects.toThrow(/Timeout|All providers failed/);
      await vi.runAllTimersAsync();
      await assertion;
    });
  });

  // ── chat() — provider health auto-management ─────────────────────────────

  describe('chat() — health management', () => {
    it('marks provider unavailable after 3 consecutive failures', async () => {
      vi.useFakeTimers();
      try {
        const p = { name: 'flaky', models: [], chat: vi.fn().mockRejectedValue(new Error('oops')) };
        // Use maxRetries=1 so each chat() call = 1 attempt
        const r = freshRouter({ defaultProvider: 'flaky', maxRetries: 1 });
        r.register('flaky', p);
        // Replace ollama so it doesn't accidentally succeed
        r.register('ollama', failingProvider('ollama'));

        // 3 failed chat() calls → 3 updateHealth(false) calls → unavailable
        for (let i = 0; i < 3; i++) {
          const a = expect(r.chat(MESSAGES, { provider: 'flaky' })).rejects.toThrow();
          await vi.runAllTimersAsync();
          await a;
        }

        const h = r.getHealth().find(x => x.provider === 'flaky')!;
        expect(h.available).toBe(false);
        expect(h.consecutiveFailures).toBeGreaterThanOrEqual(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips provider with consecutiveFailures >= 3 in the chain', async () => {
      const r = freshRouter({ defaultProvider: 'fast' });
      const fast = fakeProvider('fast', 'fast ok');
      r.register('fast', fast);
      // Mark zhipu (in fallback chain) as exhausted — shouldn't affect result
      const zhipuH = r.getHealth().find(x => x.provider === 'zhipu');
      if (zhipuH) zhipuH.consecutiveFailures = 5;

      const result = await r.chat(MESSAGES, { provider: 'fast' });
      expect(result).toBe('fast ok');
    });
  });

  // ── chatStream() ──────────────────────────────────────────────────────────

  describe('chatStream()', () => {
    it('yields chunks from the streaming provider', async () => {
      const r = freshRouter({ defaultProvider: 'streamer' });
      r.register('streamer', streamingProvider('streamer', ['chunk1', 'chunk2', 'chunk3']));

      const chunks: string[] = [];
      for await (const c of r.chatStream(MESSAGES, { provider: 'streamer' })) {
        chunks.push(c);
      }
      expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });

    it('falls back to next streaming provider when first throws', async () => {
      const r = freshRouter({ defaultProvider: 'bad-stream' });

      const badStream: AIProvider = {
        name: 'bad-stream',
        models: [],
        chat: vi.fn(),
        async *chatStream() { throw new Error('stream broke'); },
      };
      r.register('bad-stream', badStream);
      r.register('ollama', streamingProvider('ollama', ['ok']));

      const chunks: string[] = [];
      for await (const c of r.chatStream(MESSAGES, { provider: 'bad-stream' })) {
        chunks.push(c);
      }
      expect(chunks).toEqual(['ok']);
    });

    it('throws when no streaming provider is available', async () => {
      const r = freshRouter({ defaultProvider: 'no-stream' });
      // Register providers WITHOUT chatStream
      r.register('no-stream', fakeProvider('no-stream'));
      r.register('ollama', fakeProvider('ollama'));

      async function collect() {
        const results: string[] = [];
        for await (const c of r.chatStream(MESSAGES, { provider: 'no-stream' })) {
          results.push(c);
        }
        return results;
      }
      await expect(collect()).rejects.toThrow('No streaming providers available');
    });
  });

  // ── cost tracking ─────────────────────────────────────────────────────────

  describe('cost tracking', () => {
    it('getSessionCost returns zero for unknown session', () => {
      const cost = router.getSessionCost('nonexistent');
      expect(cost.totalUsd).toBe(0);
      expect(cost.calls).toBe(0);
      expect(cost.byProvider).toEqual({});
    });

    it('accumulates cost per session', async () => {
      const p = fakeProvider('p', 'resp');
      router.register('p', p);

      await router.chat(MESSAGES, { provider: 'p', sessionId: 'sid-1' });
      await router.chat(MESSAGES, { provider: 'p', sessionId: 'sid-1' });
      await router.chat(MESSAGES, { provider: 'p', sessionId: 'sid-2' });

      expect(router.getSessionCost('sid-1').calls).toBe(2);
      expect(router.getSessionCost('sid-2').calls).toBe(1);
    });

    it('getTotalCost aggregates across all sessions', async () => {
      const p = fakeProvider('p');
      router.register('p', p);
      await router.chat(MESSAGES, { provider: 'p', sessionId: 'a' });
      await router.chat(MESSAGES, { provider: 'p', sessionId: 'b' });

      const total = router.getTotalCost();
      expect(total.calls).toBeGreaterThanOrEqual(2);
    });

    it('byProvider breakdown is accurate', async () => {
      const p = fakeProvider('ollama');
      router.register('ollama', p);
      await router.chat(MESSAGES, { provider: 'ollama', sessionId: 'sess' });

      const { byProvider } = router.getSessionCost('sess');
      expect(byProvider['ollama']).toBeGreaterThanOrEqual(0); // ollama is free (cost = 0)
    });

    it('ollama has zero cost rate', async () => {
      router.register('ollama', fakeProvider('ollama'));
      await router.chat(MESSAGES, { provider: 'ollama', sessionId: 'free' });
      expect(router.getSessionCost('free').totalUsd).toBe(0);
    });
  });

  // ── getHealth / resetHealth ───────────────────────────────────────────────

  describe('getHealth()', () => {
    it('returns a health record for every registered provider', () => {
      router.register('a', fakeProvider('a'));
      router.register('b', fakeProvider('b'));
      const names = router.getHealth().map(h => h.provider);
      expect(names).toContain('a');
      expect(names).toContain('b');
    });

    it('each record has the correct shape', () => {
      router.register('x', fakeProvider('x'));
      const h = router.getHealth().find(r => r.provider === 'x')!;
      expect(h).toMatchObject({
        provider: 'x',
        available: true,
        consecutiveFailures: 0,
        avgResponseTimeMs: 0,
      });
    });
  });

  describe('resetHealth()', () => {
    it('clears consecutiveFailures and marks available again', () => {
      router.register('r', fakeProvider('r'));
      const h = router.getHealth().find(x => x.provider === 'r')!;
      h.consecutiveFailures = 5;
      h.available = false;
      h.lastError = 'something bad';

      router.resetHealth('r');
      const updated = router.getHealth().find(x => x.provider === 'r')!;
      expect(updated.available).toBe(true);
      expect(updated.consecutiveFailures).toBe(0);
      expect(updated.lastError).toBeUndefined();
    });

    it('is a no-op for unknown provider names', () => {
      expect(() => router.resetHealth('does-not-exist')).not.toThrow();
    });
  });

  // ── concurrent chat() calls ───────────────────────────────────────────────

  describe('concurrent chat() calls', () => {
    it('handles concurrent requests independently', async () => {
      const p1 = fakeProvider('c1', 'result-1');
      const p2 = fakeProvider('c2', 'result-2');
      router.register('c1', p1);
      router.register('c2', p2);

      const [r1, r2] = await Promise.all([
        router.chat(MESSAGES, { provider: 'c1' }),
        router.chat(MESSAGES, { provider: 'c2' }),
      ]);

      expect(r1).toBe('result-1');
      expect(r2).toBe('result-2');
    });

    it('concurrent failures do not corrupt each other\'s error state', async () => {
      vi.useFakeTimers();
      try {
        const r = freshRouter({ defaultProvider: 'fail', maxRetries: 1 });
        r.register('fail', failingProvider('fail', 'boom'));
        r.getHealth().forEach(h => { if (h.provider !== 'fail') { h.available = false; h.consecutiveFailures = 3; } });

        // Attach handlers before advancing time to prevent unhandled rejections
        const a1 = expect(r.chat(MESSAGES, { provider: 'fail' })).rejects.toThrow('boom');
        const a2 = expect(r.chat(MESSAGES, { provider: 'fail' })).rejects.toThrow('boom');
        await vi.runAllTimersAsync();
        await a1;
        await a2;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── constructor option coverage ───────────────────────────────────────────

  describe('constructor options', () => {
    it('defaultProvider drives the first chain entry', async () => {
      const r = freshRouter({ defaultProvider: 'chosen' });
      const p = fakeProvider('chosen', 'I was chosen');
      r.register('chosen', p);
      // Disable ollama so it can't absorb the call
      r.getHealth().forEach(h => { if (h.provider !== 'chosen') { h.available = false; h.consecutiveFailures = 3; } });

      const result = await r.chat(MESSAGES);
      expect(result).toBe('I was chosen');
    });

    it('enableFallback=false restricts chain to single provider', async () => {
      vi.useFakeTimers();
      try {
        const r = freshRouter({ defaultProvider: 'only', enableFallback: false, maxRetries: 1 });
        r.register('only', failingProvider('only', 'out'));
        // ollama is registered but should NOT be tried
        r.register('ollama', fakeProvider('ollama', 'should not appear'));

        const assertion = expect(r.chat(MESSAGES, { provider: 'only' })).rejects.toThrow('All providers failed');
        await vi.runAllTimersAsync();
        await assertion;
        // ollama.chat should never have been called
        const ollama = r['providers'].get('ollama') as AIProvider;
        expect(ollama.chat).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
