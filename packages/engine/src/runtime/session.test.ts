// @vitest-environment node
/**
 * Tests for SessionManager (packages/engine/src/runtime/session.ts).
 * session-store.ts persistence is covered separately — here we use a fake store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionManager,
  calculateSessionTokens,
  estimateTokens,
  type Channel,
  type Session,
  type SessionCreateOptions,
} from './session';
import type { SessionStore } from './session-store';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeOpts(overrides: Partial<SessionCreateOptions> = {}): SessionCreateOptions {
  return {
    channel: 'cli',
    userId: 'u1',
    chatId: 'c1',
    ...overrides,
  };
}

/** Minimal fake store — tracks calls, never throws. */
function makeFakeStore() {
  return {
    save: vi.fn<[Session], void>(),
    delete: vi.fn<[Pick<Session, 'id' | 'channel' | 'userId' | 'chatId'>], Promise<void>>().mockResolvedValue(undefined),
  } as unknown as SessionStore;
}

// ─── calculateSessionTokens ──────────────────────────────────────────────────

describe('calculateSessionTokens', () => {
  it('returns 0 for empty message array', () => {
    expect(calculateSessionTokens([])).toBe(0);
  });

  it('returns a positive number for non-empty messages', () => {
    const count = calculateSessionTokens([
      { role: 'user', content: 'hello world' },
    ]);
    expect(count).toBeGreaterThan(0);
  });
});

// ─── estimateTokens ──────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns a positive number for a non-empty string', () => {
    expect(estimateTokens('hello')).toBeGreaterThan(0);
  });

  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

// ─── create() ────────────────────────────────────────────────────────────────

describe('SessionManager.create()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns a session with a unique string id starting with "sess-"', () => {
    const s = sm.create(makeOpts());
    expect(s.id).toMatch(/^sess-/);
  });

  it('generates distinct ids for concurrent creates', () => {
    const ids = Array.from({ length: 20 }, () => sm.create(makeOpts()).id);
    expect(new Set(ids).size).toBe(20);
  });

  it('copies channel, userId, chatId from options', () => {
    const s = sm.create(makeOpts({ channel: 'telegram', userId: 'alice', chatId: 'chat42' }));
    expect(s.channel).toBe('telegram');
    expect(s.userId).toBe('alice');
    expect(s.chatId).toBe('chat42');
  });

  it('has createdAt and lastActivityAt close to now', () => {
    const before = Date.now();
    const s = sm.create(makeOpts());
    const after = Date.now();
    expect(s.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(s.createdAt.getTime()).toBeLessThanOrEqual(after);
    expect(s.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('has empty messages and tokenCount 0 when no systemPrompt', () => {
    const s = sm.create(makeOpts());
    expect(s.messages).toHaveLength(0);
    expect(s.tokenCount).toBe(0);
  });

  it('adds system message when systemPrompt provided', () => {
    const s = sm.create(makeOpts({ systemPrompt: 'You are a helpful assistant.' }));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[0].content).toBe('You are a helpful assistant.');
    expect(s.tokenCount).toBeGreaterThan(0);
  });

  it('stores systemPrompt on session even without messages being injected when empty string', () => {
    const s = sm.create(makeOpts({ systemPrompt: '' }));
    expect(s.systemPrompt).toBe('');
    expect(s.messages).toHaveLength(0);
  });

  it('uses default maxTokens (128000) when not specified', () => {
    const s = sm.create(makeOpts());
    expect(s.maxTokens).toBe(128000);
  });

  it('respects custom maxTokens', () => {
    const s = sm.create(makeOpts({ maxTokens: 4096 }));
    expect(s.maxTokens).toBe(4096);
  });

  it('stores custom metadata', () => {
    const s = sm.create(makeOpts({ metadata: { plan: 'pro' } }));
    expect(s.metadata).toMatchObject({ plan: 'pro' });
  });

  it('calls store.save once when store is attached', () => {
    const store = makeFakeStore();
    sm.setStore(store);
    const s = sm.create(makeOpts());
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith(s);
  });

  it('does not throw when no store is attached', () => {
    expect(() => sm.create(makeOpts())).not.toThrow();
  });
});

// ─── get() ───────────────────────────────────────────────────────────────────

describe('SessionManager.get()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns undefined for an unknown id', () => {
    expect(sm.get('no-such-id')).toBeUndefined();
  });

  it('returns the session object that was just created', () => {
    const s = sm.create(makeOpts());
    expect(sm.get(s.id)).toBe(s);
  });

  it('returns the same reference across multiple calls', () => {
    const s = sm.create(makeOpts());
    expect(sm.get(s.id)).toBe(sm.get(s.id));
  });
});

// ─── findByContext() ─────────────────────────────────────────────────────────

describe('SessionManager.findByContext()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('finds a session by userId + channel + chatId', () => {
    const s = sm.create(makeOpts({ userId: 'bob', channel: 'telegram', chatId: 'c99' }));
    expect(sm.findByContext('bob', 'telegram', 'c99')).toBe(s);
  });

  it('returns undefined when no matching session exists', () => {
    sm.create(makeOpts({ userId: 'bob', channel: 'telegram', chatId: 'c99' }));
    expect(sm.findByContext('bob', 'cli', 'c99')).toBeUndefined();
  });

  it('same userId different chatId → different session (no cross-contamination)', () => {
    const s1 = sm.create(makeOpts({ userId: 'u', chatId: 'chat-A' }));
    const s2 = sm.create(makeOpts({ userId: 'u', chatId: 'chat-B' }));
    expect(sm.findByContext('u', 'cli', 'chat-A')).toBe(s1);
    expect(sm.findByContext('u', 'cli', 'chat-B')).toBe(s2);
  });

  it('same chatId different channel → different session', () => {
    const s1 = sm.create(makeOpts({ channel: 'telegram', chatId: 'chat-X' }));
    const s2 = sm.create(makeOpts({ channel: 'web', chatId: 'chat-X' }));
    expect(sm.findByContext('u1', 'telegram', 'chat-X')).toBe(s1);
    expect(sm.findByContext('u1', 'web', 'chat-X')).toBe(s2);
  });

  it('can filter matching contexts by workspace metadata', () => {
    const s1 = sm.create(makeOpts({ metadata: { workspaceId: 'workspace-a' } }));
    const s2 = sm.create(makeOpts({ metadata: { workspaceId: 'workspace-b' } }));

    expect(sm.findByContext('u1', 'cli', 'c1', { workspaceId: 'workspace-a' })).toBe(s1);
    expect(sm.findByContext('u1', 'cli', 'c1', { workspaceId: 'workspace-b' })).toBe(s2);
    expect(sm.findByContext('u1', 'cli', 'c1', { workspaceId: 'workspace-c' })).toBeUndefined();
  });
});

// ─── addMessage() ────────────────────────────────────────────────────────────

describe('SessionManager.addMessage()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns success:false + error when session does not exist', () => {
    const result = sm.addMessage('ghost', { role: 'user', content: 'hi' });
    expect(result.success).toBe(false);
    expect(result.rollover).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('appends the message and returns success:true, rollover:false for small content', () => {
    const s = sm.create(makeOpts());
    const result = sm.addMessage(s.id, { role: 'user', content: 'Hello!' });
    expect(result.success).toBe(true);
    expect(result.rollover).toBe(false);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: 'user', content: 'Hello!' });
  });

  it('preserves role: assistant', () => {
    const s = sm.create(makeOpts());
    sm.addMessage(s.id, { role: 'assistant', content: 'Sure!' });
    expect(s.messages[0].role).toBe('assistant');
  });

  it('preserves role: system (mid-conversation)', () => {
    const s = sm.create(makeOpts());
    sm.addMessage(s.id, { role: 'system', content: 'System reminder.' });
    expect(s.messages[0].role).toBe('system');
  });

  it('preserves role: tool', () => {
    const s = sm.create(makeOpts());
    sm.addMessage(s.id, { role: 'tool', content: '{"result": 42}' });
    expect(s.messages[0].role).toBe('tool');
  });

  it('advances lastActivityAt after adding a message', async () => {
    const s = sm.create(makeOpts());
    const before = s.lastActivityAt.getTime();
    // Small delay to ensure time advances
    await new Promise(r => setTimeout(r, 5));
    sm.addMessage(s.id, { role: 'user', content: 'tick' });
    expect(s.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('updates tokenCount after adding a message', () => {
    const s = sm.create(makeOpts());
    expect(s.tokenCount).toBe(0);
    sm.addMessage(s.id, { role: 'user', content: 'some text here' });
    expect(s.tokenCount).toBeGreaterThan(0);
  });

  it('accumulates messages in order', () => {
    const s = sm.create(makeOpts());
    sm.addMessage(s.id, { role: 'user', content: 'first' });
    sm.addMessage(s.id, { role: 'assistant', content: 'second' });
    sm.addMessage(s.id, { role: 'user', content: 'third' });
    expect(s.messages.map(m => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('calls store.save after each addMessage when store is attached', () => {
    const store = makeFakeStore();
    sm.setStore(store);
    const s = sm.create(makeOpts());
    store.save.mockClear();

    sm.addMessage(s.id, { role: 'user', content: 'ping' });
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('triggers rollover and returns rollover:true when token limit exceeded', () => {
    // Use a tiny maxTokens so a single large message blows past 80%
    const s = sm.create(makeOpts({ maxTokens: 10 }));
    // Large enough content to exceed 8 tokens (80% of 10)
    const bigContent = 'x'.repeat(500);
    const result = sm.addMessage(s.id, { role: 'user', content: bigContent });
    expect(result.rollover).toBe(true);
  });

  it('stores a deterministic summary when rollover drops earlier messages', () => {
    const s = sm.create(makeOpts({ maxTokens: 50 }));
    sm.addMessage(s.id, { role: 'user', content: 'important decision: keep durable memory' });
    for (let i = 0; i < 12; i++) {
      sm.addMessage(s.id, { role: 'assistant', content: `filler ${i}` });
    }
    const result = sm.addMessage(s.id, { role: 'user', content: 'x'.repeat(500) });

    expect(result.rollover).toBe(true);
    expect(s.summary).toContain('important decision');
    expect(s.metadata.sessionSummary).toBe(s.summary);
    expect(typeof s.metadata.lastRolloverAt).toBe('string');
  });
});

// ─── addMessages() ───────────────────────────────────────────────────────────

describe('SessionManager.addMessages()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('adds all messages and returns success:true', () => {
    const s = sm.create(makeOpts());
    const result = sm.addMessages(s.id, [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(result.success).toBe(true);
    expect(s.messages).toHaveLength(2);
  });

  it('returns success:false when session not found', () => {
    const result = sm.addMessages('nope', [{ role: 'user', content: 'x' }]);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── getAll() ────────────────────────────────────────────────────────────────

describe('SessionManager.getAll()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns empty array when no sessions', () => {
    expect(sm.getAll()).toEqual([]);
  });

  it('returns all created sessions', () => {
    const s1 = sm.create(makeOpts({ userId: 'a' }));
    const s2 = sm.create(makeOpts({ userId: 'b' }));
    const all = sm.getAll();
    expect(all).toHaveLength(2);
    expect(all).toContain(s1);
    expect(all).toContain(s2);
  });
});

// ─── count ───────────────────────────────────────────────────────────────────

describe('SessionManager.count', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('is 0 initially', () => {
    expect(sm.count).toBe(0);
  });

  it('increments on create and decrements on destroy', () => {
    const s = sm.create(makeOpts());
    expect(sm.count).toBe(1);
    sm.destroy(s.id);
    expect(sm.count).toBe(0);
  });
});

// ─── destroy() ───────────────────────────────────────────────────────────────

describe('SessionManager.destroy()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns true and removes the session', () => {
    const s = sm.create(makeOpts());
    expect(sm.destroy(s.id)).toBe(true);
    expect(sm.get(s.id)).toBeUndefined();
  });

  it('returns false for a non-existent session (no-op)', () => {
    expect(sm.destroy('does-not-exist')).toBe(false);
  });

  it('calls store.delete when store is attached', async () => {
    const store = makeFakeStore();
    sm.setStore(store);
    const s = sm.create(makeOpts());
    sm.destroy(s.id);
    // store.delete is fire-and-forget (void); give microtasks a tick
    await Promise.resolve();
    expect(store.delete).toHaveBeenCalledOnce();
  });

  it('does not throw when destroying a non-existent id without store', () => {
    expect(() => sm.destroy('ghost')).not.toThrow();
  });
});

// ─── updateMetadata() ────────────────────────────────────────────────────────

describe('SessionManager.updateMetadata()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns true and merges metadata', () => {
    const s = sm.create(makeOpts({ metadata: { a: 1 } }));
    const ok = sm.updateMetadata(s.id, { b: 2 });
    expect(ok).toBe(true);
    expect(s.metadata).toMatchObject({ a: 1, b: 2 });
  });

  it('overwrites existing key', () => {
    const s = sm.create(makeOpts({ metadata: { x: 'old' } }));
    sm.updateMetadata(s.id, { x: 'new' });
    expect(s.metadata.x).toBe('new');
  });

  it('returns false for non-existent session', () => {
    expect(sm.updateMetadata('ghost', { foo: 'bar' })).toBe(false);
  });
});

// ─── cleanup() ───────────────────────────────────────────────────────────────

describe('SessionManager.cleanup()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('removes sessions older than maxAgeMs', () => {
    const s = sm.create(makeOpts());
    // backdate lastActivityAt to 2 hours ago
    s.lastActivityAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const removed = sm.cleanup(60 * 60 * 1000); // 1 hour
    expect(removed).toBe(1);
    expect(sm.get(s.id)).toBeUndefined();
  });

  it('keeps sessions younger than maxAgeMs', () => {
    const s = sm.create(makeOpts());
    const removed = sm.cleanup(60 * 60 * 1000);
    expect(removed).toBe(0);
    expect(sm.get(s.id)).toBeDefined();
  });

  it('returns 0 when nothing to clean', () => {
    expect(sm.cleanup()).toBe(0);
  });
});

// ─── getStats() ──────────────────────────────────────────────────────────────

describe('SessionManager.getStats()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('returns zeros for an empty manager', () => {
    const stats = sm.getStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.averageTokens).toBe(0);
  });

  it('counts sessions by channel', () => {
    sm.create(makeOpts({ channel: 'telegram' }));
    sm.create(makeOpts({ channel: 'telegram' }));
    sm.create(makeOpts({ channel: 'web' }));
    const stats = sm.getStats();
    expect(stats.byChannel.telegram).toBe(2);
    expect(stats.byChannel.web).toBe(1);
    expect(stats.byChannel.cli).toBe(0);
    expect(stats.totalSessions).toBe(3);
  });
});

// ─── restore() / hydration ───────────────────────────────────────────────────

describe('SessionManager.restore()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('loads a session into memory and makes it accessible by id', () => {
    const hydrated: Session = {
      id: 'sess-hydrated-1',
      channel: 'telegram',
      userId: 'u99',
      chatId: 'chat99',
      messages: [{ role: 'user', content: 'restored message' }],
      systemPrompt: 'sys',
      createdAt: new Date('2024-01-01'),
      lastActivityAt: new Date('2024-01-02'),
      tokenCount: 5,
      maxTokens: 128000,
      metadata: {},
    };

    sm.restore(hydrated);
    expect(sm.get('sess-hydrated-1')).toBe(hydrated);
    expect(sm.count).toBe(1);
  });

  it('does NOT call store.save when restoring (avoid re-writing unchanged data)', () => {
    const store = makeFakeStore();
    sm.setStore(store);
    store.save.mockClear();

    const hydrated: Session = {
      id: 'sess-hydrated-2',
      channel: 'cli',
      userId: 'u1',
      chatId: 'c1',
      messages: [],
      systemPrompt: '',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      tokenCount: 0,
      maxTokens: 128000,
      metadata: {},
    };

    sm.restore(hydrated);
    expect(store.save).not.toHaveBeenCalled();
  });
});

// ─── session isolation ───────────────────────────────────────────────────────

describe('session isolation', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('messages in one session do not affect another', () => {
    const s1 = sm.create(makeOpts({ userId: 'a', chatId: 'chat1' }));
    const s2 = sm.create(makeOpts({ userId: 'b', chatId: 'chat2' }));

    sm.addMessage(s1.id, { role: 'user', content: 'only for s1' });
    expect(s2.messages).toHaveLength(0);
  });

  it('all four channels are valid and isolated', () => {
    const channels: Channel[] = ['telegram', 'cli', 'tma', 'web'];
    const sessions = channels.map(ch =>
      sm.create(makeOpts({ channel: ch, userId: 'shared-user', chatId: 'shared-chat' }))
    );

    // Each channel gets its own session
    expect(new Set(sessions.map(s => s.id)).size).toBe(4);
    // findByContext returns the right one per channel
    for (const [i, ch] of channels.entries()) {
      expect(sm.findByContext('shared-user', ch, 'shared-chat')).toBe(sessions[i]);
    }
  });
});

// ─── in-memory only (no store) ───────────────────────────────────────────────

describe('in-memory only (no store attached)', () => {
  it('full create → addMessage → destroy lifecycle works without a store', () => {
    const sm = new SessionManager();
    const s = sm.create(makeOpts());
    sm.addMessage(s.id, { role: 'user', content: 'hello' });
    expect(s.messages).toHaveLength(1);
    expect(sm.destroy(s.id)).toBe(true);
    expect(sm.count).toBe(0);
  });
});

// ─── setStore() swap ─────────────────────────────────────────────────────────

describe('setStore()', () => {
  it('detaches store when called with null', () => {
    const sm = new SessionManager();
    const store = makeFakeStore();
    sm.setStore(store);
    sm.setStore(null);

    const s = sm.create(makeOpts());
    sm.addMessage(s.id, { role: 'user', content: 'x' });

    // store was detached, so save should not have been called after setStore(null)
    expect(store.save).not.toHaveBeenCalled();
  });
});

// ─── withSessionLock() (A9) ──────────────────────────────────────────────────

describe('SessionManager.withSessionLock()', () => {
  let sm: SessionManager;

  beforeEach(() => { sm = new SessionManager(); });

  it('executes a synchronous fn and resolves with its return value', async () => {
    const s = sm.create(makeOpts());
    const result = await sm.withSessionLock(s.id, () => 42);
    expect(result).toBe(42);
  });

  it('executes an async fn and resolves with its return value', async () => {
    const s = sm.create(makeOpts());
    const result = await sm.withSessionLock(s.id, async () => {
      await Promise.resolve();
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('serialises 100 concurrent async addMessage calls — final count is 100', async () => {
    const s = sm.create(makeOpts());

    // Each operation yields to the event loop before calling addMessage so that
    // without a mutex the ordering would be non-deterministic.
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        sm.withSessionLock(s.id, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          sm.addMessage(s.id, { role: 'user', content: `msg-${i}` });
        })
      )
    );

    const session = sm.get(s.id)!;
    expect(session.messages).toHaveLength(100);
  });

  it('serialises concurrent operations — order is preserved (FIFO)', async () => {
    const s = sm.create(makeOpts());
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        sm.withSessionLock(s.id, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          order.push(i);
        })
      )
    );

    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('does not block operations on different session ids', async () => {
    const s1 = sm.create(makeOpts({ userId: 'u1', chatId: 'c1' }));
    const s2 = sm.create(makeOpts({ userId: 'u2', chatId: 'c2' }));

    const completionOrder: string[] = [];

    // s2's lock should not wait for s1's slow lock.
    const slow = sm.withSessionLock(s1.id, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      completionOrder.push('s1');
    });

    const fast = sm.withSessionLock(s2.id, async () => {
      completionOrder.push('s2');
    });

    await Promise.all([slow, fast]);

    expect(completionOrder[0]).toBe('s2'); // s2 finishes first
    expect(completionOrder[1]).toBe('s1');
  });

  it('a rejected fn does not poison the mutex — subsequent calls still run', async () => {
    const s = sm.create(makeOpts());

    // First call rejects.
    await expect(
      sm.withSessionLock(s.id, async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    // Second call should still execute normally.
    const result = await sm.withSessionLock(s.id, () => 'recovered');
    expect(result).toBe('recovered');
  });
});
