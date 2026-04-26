import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sliceContextAround,
  computePrefixHash,
  computeSuggestionId,
  classifyTrigger,
  estimateConfidence,
  InlineEngine,
  InlineRequest,
  InlineSuggestion,
  DaemonClientLike,
} from '../inline';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type MockDaemon = {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
} & DaemonClientLike;

function makeDaemon(
  sendImpl: (type: string, payload: unknown) => Promise<unknown> = () =>
    Promise.resolve([]),
): MockDaemon {
  return {
    send: vi.fn(sendImpl),
    on: vi.fn(() => () => {}),
    isConnected: vi.fn(() => true),
  };
}

function makeRequest(overrides: Partial<InlineRequest> = {}): InlineRequest {
  return {
    docId: 'doc1',
    languageId: 'typescript',
    fullText: 'const x = 1;\nconst y = 2;\n',
    cursorOffset: 13,
    triggerKind: 'auto',
    ...overrides,
  };
}

/** One-element daemon response with the given text. */
function oneItem(text = 'foo()'): unknown[] {
  return [{ text, logprob: -0.1, finishReason: 'stop' }];
}

const DEFAULT_TRIGGER_CHARS = ['.', '(', ',', ' ', '\n', '/', '<', '>'];

// ---------------------------------------------------------------------------
// sliceContextAround
// ---------------------------------------------------------------------------

describe('sliceContextAround', () => {
  it('returns exactly N lines centred around cursor when file is large enough', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const text = lines.join('\n');
    // Each 'lineN' is 5 chars; line i starts at i*(5+1)=i*6 for i<10 etc.
    // cursor at start of line 50: text.slice(0, offset) ends with 50 '\n's
    // lines 0..49 joined: 50 lines × 5 chars + 49 separators = 299 chars
    // add the 50th newline → offset = 300 puts cursor at start of line 50
    const offset = 300;
    const result = sliceContextAround(text, offset, 80);
    expect(result.endLine - result.startLine + 1).toBe(80);
  });

  it('respects file start boundary when cursor is near the top', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const text = lines.join('\n');
    // Cursor near middle — file has only 20 lines so the window clips
    const result = sliceContextAround(text, Math.floor(text.length / 2), 80);
    expect(result.startLine).toBe(0);
    expect(result.endLine).toBe(19);
  });

  it('returns entire text when text is shorter than window', () => {
    const text = 'hello\nworld';
    const result = sliceContextAround(text, 6, 80);
    expect(result.snippet).toBe(text);
    expect(result.startLine).toBe(0);
    expect(result.endLine).toBe(1);
  });

  it('handles offset at position 0', () => {
    const text = 'line0\nline1\nline2';
    const result = sliceContextAround(text, 0, 80);
    expect(result.startLine).toBe(0);
  });

  it('handles offset at end of text', () => {
    const text = 'line0\nline1\nline2';
    const result = sliceContextAround(text, text.length, 80);
    expect(result.endLine).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computePrefixHash
// ---------------------------------------------------------------------------

describe('computePrefixHash', () => {
  it('is deterministic for the same text and offset', () => {
    const text = 'hello world';
    expect(computePrefixHash(text, 5)).toBe(computePrefixHash(text, 5));
  });

  it('differs after an edit', () => {
    const text1 = 'hello world';
    const text2 = 'hello earth';
    expect(computePrefixHash(text1, text1.length)).not.toBe(
      computePrefixHash(text2, text2.length),
    );
  });

  it('uses only the last 200 chars — same suffix → same hash', () => {
    const suffix = 'x'.repeat(200);
    const hash1 = computePrefixHash('AAA' + suffix, 203);
    const hash2 = computePrefixHash('ZZZ' + suffix, 203);
    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// computeSuggestionId
// ---------------------------------------------------------------------------

describe('computeSuggestionId', () => {
  it('is stable for identical inputs', () => {
    expect(computeSuggestionId('doc1', 10, 'foo()')).toBe(
      computeSuggestionId('doc1', 10, 'foo()'),
    );
  });

  it('differs when suggestion text changes', () => {
    expect(computeSuggestionId('doc1', 10, 'foo()')).not.toBe(
      computeSuggestionId('doc1', 10, 'bar()'),
    );
  });

  it('differs when offset changes', () => {
    expect(computeSuggestionId('doc1', 10, 'foo()')).not.toBe(
      computeSuggestionId('doc1', 11, 'foo()'),
    );
  });
});

// ---------------------------------------------------------------------------
// classifyTrigger
// ---------------------------------------------------------------------------

describe('classifyTrigger', () => {
  it('"." returns auto', () => {
    expect(classifyTrigger('.', DEFAULT_TRIGGER_CHARS)).toBe('auto');
  });

  it('"a" (letter) returns none', () => {
    expect(classifyTrigger('a', DEFAULT_TRIGGER_CHARS)).toBe('none');
  });

  it('"z" (letter) returns none', () => {
    expect(classifyTrigger('z', DEFAULT_TRIGGER_CHARS)).toBe('none');
  });

  it('space returns auto', () => {
    expect(classifyTrigger(' ', DEFAULT_TRIGGER_CHARS)).toBe('auto');
  });

  it('newline returns auto', () => {
    expect(classifyTrigger('\n', DEFAULT_TRIGGER_CHARS)).toBe('auto');
  });

  it('undefined prevChar returns none', () => {
    expect(classifyTrigger(undefined, DEFAULT_TRIGGER_CHARS)).toBe('none');
  });

  it('"(" returns auto', () => {
    expect(classifyTrigger('(', DEFAULT_TRIGGER_CHARS)).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// estimateConfidence
// ---------------------------------------------------------------------------

describe('estimateConfidence', () => {
  it('returns 0.5 when both fields are missing', () => {
    expect(estimateConfidence({})).toBe(0.5);
  });

  it('returns >0.5 for finishReason=stop with logprob=-0.1', () => {
    const c = estimateConfidence({ finishReason: 'stop', logprob: -0.1 });
    expect(c).toBeGreaterThan(0.5);
  });

  it('returns >0.5 for finishReason=stop alone', () => {
    expect(estimateConfidence({ finishReason: 'stop' })).toBeGreaterThan(0.5);
  });

  it('returns <0.5 for finishReason=length (truncated)', () => {
    expect(estimateConfidence({ finishReason: 'length' })).toBeLessThan(0.5);
  });

  it('clamps to [0, 1]', () => {
    const c = estimateConfidence({ logprob: 0, finishReason: 'stop' });
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — request
// ---------------------------------------------------------------------------

describe('InlineEngine.request', () => {
  it('sends inline.complete with snippet and cursorOffset', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    const req = makeRequest();
    await engine.request(req);
    expect(daemon.send).toHaveBeenCalledWith(
      'inline.complete',
      expect.objectContaining({
        snippet: expect.any(String),
        cursorOffset: req.cursorOffset,
      }),
    );
  });

  it('returns null when daemon returns empty array', async () => {
    const daemon = makeDaemon(() => Promise.resolve([]));
    const engine = new InlineEngine({ daemon });
    expect(await engine.request(makeRequest())).toBeNull();
  });

  it('returns null when daemon returns empty suggestions object', async () => {
    const daemon = makeDaemon(() =>
      Promise.resolve({ suggestions: [] }),
    );
    const engine = new InlineEngine({ daemon });
    expect(await engine.request(makeRequest())).toBeNull();
  });

  it('returns the first suggestion when daemon returns an array', async () => {
    const daemon = makeDaemon(() =>
      Promise.resolve(oneItem('console.log()')),
    );
    const engine = new InlineEngine({ daemon });
    const result = await engine.request(makeRequest());
    expect(result).not.toBeNull();
    expect(result!.text).toBe('console.log()');
  });

  it('returns suggestion from wrapped { suggestions: [...] } format', async () => {
    const daemon = makeDaemon(() =>
      Promise.resolve({ suggestions: oneItem('wrap()') }),
    );
    const engine = new InlineEngine({ daemon });
    const result = await engine.request(makeRequest());
    expect(result!.text).toBe('wrap()');
  });

  it('suggestion has correct range (startOffset === endOffset === cursorOffset)', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    const req = makeRequest({ cursorOffset: 7 });
    const result = await engine.request(req);
    expect(result!.range).toEqual({ startOffset: 7, endOffset: 7 });
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — caching
// ---------------------------------------------------------------------------

describe('InlineEngine cache', () => {
  it('returns cached suggestion on second identical request; daemon called once', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    const req = makeRequest();

    await engine.request(req);
    const second = await engine.request(req);

    expect(daemon.send).toHaveBeenCalledTimes(1);
    expect(second).not.toBeNull();
    expect(engine.getCacheStats().hits).toBe(1);
  });

  it('getCacheStats reflects hits and misses correctly', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    const req = makeRequest();

    await engine.request(req); // miss
    await engine.request(req); // hit
    await engine.request(req); // hit

    expect(engine.getCacheStats()).toEqual({ size: 1, hits: 2, misses: 1 });
  });

  it('different docId produces a different cache key (separate miss)', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });

    await engine.request(makeRequest({ docId: 'doc1' }));
    await engine.request(makeRequest({ docId: 'doc2' }));

    expect(daemon.send).toHaveBeenCalledTimes(2);
    expect(engine.getCacheStats().misses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — clearCache
// ---------------------------------------------------------------------------

describe('InlineEngine.clearCache', () => {
  it('resets size, hits and misses to zero', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    const req = makeRequest();

    await engine.request(req); // miss
    await engine.request(req); // hit
    engine.clearCache();

    expect(engine.getCacheStats()).toEqual({ size: 0, hits: 0, misses: 0 });
  });

  it('causes a cache miss on the next request after clear', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    const req = makeRequest();

    await engine.request(req); // miss → cached
    await engine.request(req); // hit
    engine.clearCache();
    await engine.request(req); // should miss again

    expect(daemon.send).toHaveBeenCalledTimes(2);
    expect(engine.getCacheStats().misses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — shouldTrigger
// ---------------------------------------------------------------------------

describe('InlineEngine.shouldTrigger', () => {
  it('returns false when user is typing faster than minIdleMs', () => {
    const engine = new InlineEngine({ daemon: makeDaemon(), minIdleMs: 80 });
    expect(engine.shouldTrigger(makeRequest(), Date.now())).toBe(false);
  });

  it('returns false when lastKeystroke was minIdleMs - 1 ms ago', () => {
    const engine = new InlineEngine({ daemon: makeDaemon(), minIdleMs: 80 });
    expect(engine.shouldTrigger(makeRequest(), Date.now() - 79)).toBe(false);
  });

  it('returns true when enough idle time has passed', () => {
    const engine = new InlineEngine({ daemon: makeDaemon(), minIdleMs: 80 });
    expect(engine.shouldTrigger(makeRequest(), Date.now() - 100)).toBe(true);
  });

  it('returns false when engine is disabled', () => {
    const engine = new InlineEngine({ daemon: makeDaemon(), minIdleMs: 80 });
    engine.disable();
    expect(engine.shouldTrigger(makeRequest(), Date.now() - 200)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — accept / reject
// ---------------------------------------------------------------------------

describe('InlineEngine accept/reject', () => {
  let daemon: MockDaemon;
  let engine: InlineEngine;
  let suggestion: InlineSuggestion;

  beforeEach(async () => {
    daemon = makeDaemon(() => Promise.resolve(oneItem('hello')));
    engine = new InlineEngine({ daemon });
    const result = await engine.request(makeRequest());
    suggestion = result!;
  });

  it('accept sends inline.accepted with suggestion id', () => {
    engine.accept(suggestion, { docId: 'doc1' });
    expect(daemon.send).toHaveBeenCalledWith(
      'inline.accepted',
      expect.objectContaining({ id: suggestion.id }),
    );
  });

  it('accept sends inline.accepted with docId', () => {
    engine.accept(suggestion, { docId: 'doc1' });
    expect(daemon.send).toHaveBeenCalledWith(
      'inline.accepted',
      expect.objectContaining({ docId: 'doc1' }),
    );
  });

  it('reject sends inline.rejected with suggestion id', () => {
    engine.reject(suggestion, { docId: 'doc1' });
    expect(daemon.send).toHaveBeenCalledWith(
      'inline.rejected',
      expect.objectContaining({ id: suggestion.id }),
    );
  });

  it('reject evicts the suggestion from cache so next request calls daemon', async () => {
    engine.reject(suggestion, { docId: 'doc1' });
    // daemon.send call count is now 2 (inline.complete + inline.rejected)
    await engine.request(makeRequest());
    // Third call should be another inline.complete
    expect(daemon.send).toHaveBeenCalledTimes(3);
    expect(daemon.send).toHaveBeenNthCalledWith(
      3,
      'inline.complete',
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — disable / enable
// ---------------------------------------------------------------------------

describe('InlineEngine disable/enable', () => {
  it('disable() makes request return null without calling daemon', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    engine.disable();

    expect(await engine.request(makeRequest())).toBeNull();
    expect(daemon.send).not.toHaveBeenCalled();
  });

  it('disable() makes suggest return [] without calling daemon', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    engine.disable();

    expect(await engine.suggest(makeRequest())).toEqual([]);
    expect(daemon.send).not.toHaveBeenCalled();
  });

  it('enable() restores request after disable', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon });
    engine.disable();
    engine.enable();

    const result = await engine.request(makeRequest());
    expect(result).not.toBeNull();
    expect(daemon.send).toHaveBeenCalledTimes(1);
  });

  it('engine created with enabled:false behaves like disabled', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon, enabled: false });

    expect(await engine.request(makeRequest())).toBeNull();
    expect(daemon.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — error handling
// ---------------------------------------------------------------------------

describe('InlineEngine error handling', () => {
  it('returns null and does not throw when daemon rejects', async () => {
    const daemon = makeDaemon(() => Promise.reject(new Error('network error')));
    const engine = new InlineEngine({ daemon });

    await expect(engine.request(makeRequest())).resolves.toBeNull();
  });

  it('suggest returns [] and does not throw when daemon rejects', async () => {
    const daemon = makeDaemon(() => Promise.reject(new Error('boom')));
    const engine = new InlineEngine({ daemon });

    await expect(engine.suggest(makeRequest())).resolves.toEqual([]);
  });

  it('handles malformed daemon response gracefully', async () => {
    const daemon = makeDaemon(() => Promise.resolve(null));
    const engine = new InlineEngine({ daemon });

    await expect(engine.request(makeRequest())).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — LRU eviction
// ---------------------------------------------------------------------------

describe('InlineEngine LRU eviction', () => {
  it('cacheSize=2: third unique prefix evicts the oldest; re-request misses', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon, cacheSize: 2 });

    const req1 = makeRequest({ docId: 'lru-doc1' });
    const req2 = makeRequest({ docId: 'lru-doc2' });
    const req3 = makeRequest({ docId: 'lru-doc3' });

    await engine.request(req1); // miss — cache: [doc1]
    await engine.request(req2); // miss — cache: [doc1, doc2]
    await engine.request(req3); // miss — evicts doc1; cache: [doc2, doc3]

    expect(engine.getCacheStats().size).toBe(2);
    expect(daemon.send).toHaveBeenCalledTimes(3);

    // doc1 was evicted — must call daemon again
    await engine.request(req1);
    expect(daemon.send).toHaveBeenCalledTimes(4);
  });

  it('accessing a cached entry promotes it above the eviction candidate', async () => {
    const daemon = makeDaemon(() => Promise.resolve(oneItem()));
    const engine = new InlineEngine({ daemon, cacheSize: 2 });

    const req1 = makeRequest({ docId: 'promo-doc1' });
    const req2 = makeRequest({ docId: 'promo-doc2' });
    const req3 = makeRequest({ docId: 'promo-doc3' });

    await engine.request(req1); // miss → cache: [doc1]; calls=1
    await engine.request(req2); // miss → cache: [doc1, doc2], LRU=doc1; calls=2
    await engine.request(req1); // HIT  → promotes doc1, LRU=doc2; calls=2
    await engine.request(req3); // miss → evicts doc2 (LRU); cache: [doc1, doc3]; calls=3

    // doc3 is still cached — must NOT call daemon
    const callsBefore = (daemon.send as ReturnType<typeof vi.fn>).mock.calls.length;
    await engine.request(req3);
    expect((daemon.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

    // doc2 was evicted — must call daemon
    await engine.request(req2);
    expect((daemon.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// InlineEngine — suggest (multi-suggestion)
// ---------------------------------------------------------------------------

describe('InlineEngine.suggest', () => {
  it('returns all suggestions from daemon', async () => {
    const daemon = makeDaemon(() =>
      Promise.resolve([
        { text: 'foo()', finishReason: 'stop' },
        { text: 'bar()', finishReason: 'stop' },
      ]),
    );
    const engine = new InlineEngine({ daemon });
    const results = await engine.suggest(makeRequest());
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('foo()');
    expect(results[1].text).toBe('bar()');
  });

  it('returns [] when daemon returns empty array', async () => {
    const daemon = makeDaemon(() => Promise.resolve([]));
    const engine = new InlineEngine({ daemon });
    expect(await engine.suggest(makeRequest())).toEqual([]);
  });
});
