// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  createSessionSummarizer,
} from './session-summarizer.js';
import type { ChatMessage, SessionSummarizerOptions } from './session-summarizer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLlm(response = 'Summary text.'): (p: string) => Promise<string> {
  return vi.fn().mockResolvedValue(response);
}

function msg(role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { role, content, ...extra };
}

/** Creates a string of exactly `n` chars so estimate = ceil(n/4). */
function chars(n: number): string {
  return 'x'.repeat(n);
}

// ── estimate ──────────────────────────────────────────────────────────────────

describe('estimate', () => {
  it('sums Math.ceil(length/4) for each message', () => {
    const s = createSessionSummarizer({ llm: makeLlm() });
    // 4 chars → 1, 8 chars → 2, 3 chars → 1 (ceil(3/4)=1)
    const messages: ChatMessage[] = [
      msg('user', chars(4)),
      msg('assistant', chars(8)),
      msg('user', chars(3)),
    ];
    expect(s.estimate(messages)).toBe(1 + 2 + 1);
  });

  it('returns 0 for empty array', () => {
    const s = createSessionSummarizer({ llm: makeLlm() });
    expect(s.estimate([])).toBe(0);
  });

  it('uses custom estimateTokens when provided', () => {
    const custom = vi.fn((str: string) => str.length * 2);
    const s = createSessionSummarizer({ llm: makeLlm(), estimateTokens: custom });
    const messages = [msg('user', 'hello')]; // length=5, *2=10
    expect(s.estimate(messages)).toBe(10);
    expect(custom).toHaveBeenCalledWith('hello');
  });
});

// ── shouldCompress ────────────────────────────────────────────────────────────

describe('shouldCompress', () => {
  it('returns false when estimate is below budget', () => {
    const s = createSessionSummarizer({ llm: makeLlm(), maxTokens: 8000, reservedTokens: 2000 });
    // budget=6000; a small message
    expect(s.shouldCompress([msg('user', chars(4))])).toBe(false);
  });

  it('returns true when estimate exceeds budget', () => {
    const s = createSessionSummarizer({ llm: makeLlm(), maxTokens: 100, reservedTokens: 20 });
    // budget=80; 400 chars → 100 tokens
    expect(s.shouldCompress([msg('user', chars(400))])).toBe(true);
  });

  it('returns false when exactly at budget', () => {
    // budget=80 tokens; 320 chars → exactly 80 tokens (not strictly >)
    const s = createSessionSummarizer({ llm: makeLlm(), maxTokens: 100, reservedTokens: 20 });
    expect(s.shouldCompress([msg('user', chars(320))])).toBe(false);
  });

  it('returns true when one token over budget', () => {
    const s = createSessionSummarizer({ llm: makeLlm(), maxTokens: 100, reservedTokens: 20 });
    // budget=80; 321 chars → ceil(321/4)=81
    expect(s.shouldCompress([msg('user', chars(321))])).toBe(true);
  });
});

// ── summarize ─────────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('returns empty summary and no llm call for empty array', async () => {
    const llm = makeLlm();
    const s = createSessionSummarizer({ llm });
    const result = await s.summarize([]);
    expect(result).toEqual({ summary: '', preserved: [], droppedCount: 0 });
    expect(llm).not.toHaveBeenCalled();
  });

  it('returns empty summary and no llm call when nothing needs dropping', async () => {
    const llm = makeLlm();
    const s = createSessionSummarizer({ llm, maxTokens: 8000, reservedTokens: 0 });
    const messages = [msg('user', 'hello'), msg('assistant', 'world')];
    const result = await s.summarize(messages);
    expect(result.droppedCount).toBe(0);
    expect(result.summary).toBe('');
    expect(llm).not.toHaveBeenCalled();
  });

  it('calls llm with proper prompt template', async () => {
    const llm = makeLlm('My summary.');
    // budget=10 tokens (40 chars); we'll have many messages
    const s = createSessionSummarizer({ llm, maxTokens: 50, reservedTokens: 40 });
    // budget = 10 tokens = 40 chars
    const messages = [
      msg('user', chars(40)),    // 10 tokens — gets dropped
      msg('assistant', chars(4)), // 1 token   — fits in preserved
    ];
    await s.summarize(messages);
    expect(llm).toHaveBeenCalledOnce();
    const prompt = (llm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain('TRANSCRIPT:');
    expect(prompt).toContain('SUMMARY:');
    expect(prompt).toContain('user goals');
    expect(prompt).toContain('[user]');
  });

  it('includes dropped messages in transcript, not preserved', async () => {
    const llm = makeLlm('Summary.');
    const s = createSessionSummarizer({ llm, maxTokens: 50, reservedTokens: 40 });
    // budget = 10 tokens (40 chars)
    const messages = [
      msg('user', chars(40)),      // 10 tokens — dropped
      msg('assistant', chars(4)),  // 1 token   — preserved
    ];
    const result = await s.summarize(messages);
    expect(result.droppedCount).toBe(1);
    expect(result.preserved).toHaveLength(1);
    expect(result.preserved[0].content).toBe(chars(4));
    const prompt = (llm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain(chars(40));
  });

  it('always preserves leading system messages', async () => {
    const llm = makeLlm('Summary.');
    // Very tight budget so non-system msgs get dropped
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    // budget = 5 tokens = 20 chars
    const messages = [
      msg('system', 'sys1'),
      msg('system', 'sys2'),
      msg('user', chars(100)), // way over budget
    ];
    const result = await s.summarize(messages);
    const systemPreserved = result.preserved.filter((m) => m.role === 'system');
    expect(systemPreserved).toHaveLength(2);
    expect(result.preserved[0].content).toBe('sys1');
    expect(result.preserved[1].content).toBe('sys2');
  });

  it('droppedCount is accurate', async () => {
    const llm = makeLlm('S.');
    const s = createSessionSummarizer({ llm, maxTokens: 20, reservedTokens: 10 });
    // budget = 10 tokens = 40 chars
    const messages = [
      msg('user', chars(40)),      // 10 — fits exactly, preserved
      msg('user', chars(40)),      // 10 — would overflow → dropped
      msg('user', chars(40)),      // 10 — would overflow → dropped
      msg('assistant', chars(4)),  // 1  — last, fits
    ];
    const result = await s.summarize(messages);
    // From the end: assistant(1) + user(10) = 11 > 10 → only assistant fits
    // Actually budget=10: assistant(1) fits, next user(10): 1+10=11 > 10 → stop
    // So droppedCount = 3
    expect(result.droppedCount).toBe(3);
    expect(result.preserved).toHaveLength(1);
  });

  it('summary contains [Conversation summary] prefix', async () => {
    const llm = makeLlm('The summary body.');
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    const messages = [msg('user', chars(100))];
    const result = await s.summarize(messages);
    expect(result.summary).toMatch(/^\[Conversation summary\]/);
    expect(result.summary).toContain('The summary body.');
  });

  it('preserves chronological order of preserved messages', async () => {
    const llm = makeLlm('S.');
    const s = createSessionSummarizer({ llm, maxTokens: 30, reservedTokens: 10 });
    // budget = 20 tokens = 80 chars
    const messages = [
      msg('user', chars(100)),      // dropped
      msg('assistant', chars(4)),   // preserved (last 3 fit)
      msg('user', chars(4)),        // preserved
      msg('assistant', chars(4)),   // preserved
    ];
    const result = await s.summarize(messages);
    expect(result.preserved[0].role).toBe('assistant');
    expect(result.preserved[1].role).toBe('user');
    expect(result.preserved[2].role).toBe('assistant');
  });

  it('llm rejection propagates', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('LLM failed'));
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    const messages = [msg('user', chars(100))];
    await expect(s.summarize(messages)).rejects.toThrow('LLM failed');
  });

  it('only-system messages → no compression needed, no llm call', async () => {
    const llm = makeLlm();
    const s = createSessionSummarizer({ llm, maxTokens: 8000, reservedTokens: 2000 });
    const messages = [msg('system', 'You are a helpful assistant.')];
    const result = await s.summarize(messages);
    expect(result.droppedCount).toBe(0);
    expect(result.summary).toBe('');
    expect(llm).not.toHaveBeenCalled();
  });

  it('preserves system messages even when system tokens exceed budget', async () => {
    const llm = makeLlm('S.');
    // budget is tiny but system msgs always go through
    const s = createSessionSummarizer({ llm, maxTokens: 5, reservedTokens: 4 });
    // budget = 1 token
    const messages = [
      msg('system', 'Big system prompt that is very long and exceeds everything'),
      msg('user', chars(100)),
    ];
    const result = await s.summarize(messages);
    expect(result.preserved.some((m) => m.role === 'system')).toBe(true);
  });
});

// ── compress ──────────────────────────────────────────────────────────────────

describe('compress', () => {
  it('returns [system, summarySystem, ...preserved] when compression happens', async () => {
    const llm = makeLlm('Compressed summary.');
    const s = createSessionSummarizer({ llm, maxTokens: 30, reservedTokens: 20 });
    // budget = 10 tokens = 40 chars
    const messages = [
      msg('system', 'Be helpful.'),
      msg('user', chars(100)),     // dropped
      msg('assistant', chars(4)),  // preserved
    ];
    const result = await s.compress(messages);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('Be helpful.');
    expect(result[1].role).toBe('system');
    expect(result[1].content).toMatch(/^\[Conversation summary\]/);
    expect(result[2].content).toBe(chars(4));
  });

  it('returns original messages copy when no compression needed', async () => {
    const llm = makeLlm();
    const s = createSessionSummarizer({ llm, maxTokens: 8000, reservedTokens: 0 });
    const messages = [msg('user', 'hello'), msg('assistant', 'world')];
    const result = await s.compress(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('hello');
    expect(llm).not.toHaveBeenCalled();
  });

  it('summary message role is system', async () => {
    const llm = makeLlm('Summary.');
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    const messages = [msg('user', chars(100))];
    const result = await s.compress(messages);
    const summaryMsg = result.find((m) => m.content.includes('[Conversation summary]'));
    expect(summaryMsg?.role).toBe('system');
  });

  it('no system messages in original — compress still works', async () => {
    const llm = makeLlm('Summary.');
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    // budget = 5 tokens = 20 chars
    const messages = [
      msg('user', chars(100)),     // dropped
      msg('assistant', chars(4)),  // preserved
    ];
    const result = await s.compress(messages);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toMatch(/^\[Conversation summary\]/);
    expect(result[1].content).toBe(chars(4));
  });

  it('preserves order: system msgs → summary → tail', async () => {
    const llm = makeLlm('S.');
    const s = createSessionSummarizer({ llm, maxTokens: 30, reservedTokens: 20 });
    // budget=10 tokens=40 chars
    const messages = [
      msg('system', 'sys'),
      msg('user', chars(100)),
      msg('assistant', chars(4)),
      msg('user', chars(4)),
    ];
    const result = await s.compress(messages);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('sys');
    expect(result[1].content).toMatch(/\[Conversation summary\]/);
    expect(result[2].content).toBe(chars(4));
    expect(result[3].content).toBe(chars(4));
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('custom estimateTokens is used in shouldCompress', () => {
    const custom = (s: string) => s.length; // 1 token per char
    const s = createSessionSummarizer({ llm: makeLlm(), maxTokens: 100, reservedTokens: 20, estimateTokens: custom });
    // budget=80; 81 chars → 81 tokens > 80
    expect(s.shouldCompress([msg('user', chars(81))])).toBe(true);
    expect(s.shouldCompress([msg('user', chars(80))])).toBe(false);
  });

  it('custom estimateTokens used in summarize', async () => {
    const custom = vi.fn((s: string) => s.length);
    const llm = makeLlm('S.');
    const s = createSessionSummarizer({ llm, maxTokens: 50, reservedTokens: 10, estimateTokens: custom });
    // budget=40; large message will be dropped
    const messages = [msg('user', chars(100)), msg('assistant', chars(4))];
    await s.summarize(messages);
    expect(custom).toHaveBeenCalled();
  });

  it('multiple system messages at start all preserved', async () => {
    const llm = makeLlm('S.');
    const s = createSessionSummarizer({ llm, maxTokens: 20, reservedTokens: 10 });
    // budget=10 tokens=40 chars
    const messages = [
      msg('system', 'sys1'),
      msg('system', 'sys2'),
      msg('system', 'sys3'),
      msg('user', chars(100)), // dropped
    ];
    const result = await s.summarize(messages);
    const sys = result.preserved.filter((m) => m.role === 'system');
    expect(sys).toHaveLength(3);
  });

  it('formatted transcript uses [role] content format', async () => {
    const llm = makeLlm('S.');
    // budget=5 tokens=20 chars; message is 100 chars → 25 tokens → dropped
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    const content = 'hello world' + chars(89); // 100 chars total
    const messages = [msg('user', content)];
    await s.summarize(messages);
    const prompt = (llm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain('[user]');
    expect(prompt).toContain('hello world');
  });

  it('large conversation: only last messages fitting budget are preserved', async () => {
    const llm = makeLlm('S.');
    // budget = 5 tokens = 20 chars
    const s = createSessionSummarizer({ llm, maxTokens: 10, reservedTokens: 5 });
    const messages = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', chars(4)), // each 1 token
    );
    const result = await s.summarize(messages);
    // 5 messages should fit
    expect(result.preserved).toHaveLength(5);
    expect(result.droppedCount).toBe(15);
  });
});
