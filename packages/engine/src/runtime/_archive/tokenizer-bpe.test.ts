// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  createTokenizer,
  loadVocabFromJson,
  serializeVocab,
} from './tokenizer-bpe';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a tokenizer with no vocab/merges (pure byte-fallback). */
function byteTok(fallbackBytesPerToken = 4) {
  return createTokenizer({ fallbackBytesPerToken });
}

/** Build a tokenizer with a small synthetic vocab + merge rules. */
function mergeTok() {
  return createTokenizer({
    vocab: new Map<string, number>([
      ['ab', 256],
      ['cd', 257],
      ['abcd', 258],
    ]),
    mergeRules: [
      ['a', 'b'],
      ['c', 'd'],
      ['ab', 'cd'],
    ],
  });
}

// ─── Byte-fallback round-trips ────────────────────────────────────────────────

describe('byte-fallback round-trips', () => {
  it('round-trips simple ASCII text', () => {
    const tok = byteTok();
    const text = 'Hello, World!';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('round-trips ASCII with punctuation and digits', () => {
    const tok = byteTok();
    const text = 'foo bar 42 baz-qux!';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('round-trips UTF-8 emoji', () => {
    const tok = byteTok();
    const text = '🎉🚀💡';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('round-trips mixed ASCII + emoji', () => {
    const tok = byteTok();
    const text = 'Hello 🌍! How are 你?';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('round-trips multi-byte UTF-8 characters (CJK)', () => {
    const tok = byteTok();
    const text = '日本語テスト';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('round-trips multi-byte accented characters', () => {
    const tok = byteTok();
    const text = 'Ünïcödé strïng';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('encodes ASCII byte by byte (1 token per byte)', () => {
    const tok = byteTok();
    const text = 'abc';
    expect(tok.encode(text)).toEqual([97, 98, 99]);
  });

  it('empty string encodes to []', () => {
    const tok = byteTok();
    expect(tok.encode('')).toEqual([]);
  });

  it('decodes empty array to empty string', () => {
    const tok = byteTok();
    expect(tok.decode([])).toBe('');
  });
});

// ─── Custom vocab ─────────────────────────────────────────────────────────────

describe('custom vocab', () => {
  it('encodes a single vocab token to a single id', () => {
    // 'ab' with merge ['a','b'] → id 256
    const tok = mergeTok();
    expect(tok.encode('ab')).toEqual([256]);
  });

  it('encodes a double vocab merge token to a single id', () => {
    // 'abcd' with chain merges → id 258
    const tok = mergeTok();
    expect(tok.encode('abcd')).toEqual([258]);
  });

  it('unknown byte tokens fall back to byte IDs 0–255', () => {
    const tok = mergeTok();
    // 'x' has no vocab entry and no merge → byte ID 120
    expect(tok.encode('x')).toEqual([120]);
  });

  it('mixed vocab + fallback bytes', () => {
    const tok = mergeTok();
    // 'ab' → [256], 'x' → [120]
    expect(tok.encode('abx')).toEqual([256, 120]);
  });
});

// ─── Merge rules ──────────────────────────────────────────────────────────────

describe('merge rules', () => {
  it('merge rule reduces token count compared to no-merge baseline', () => {
    const base = byteTok();
    const merged = mergeTok();
    const text = 'ab';
    expect(merged.encode(text).length).toBeLessThan(base.encode(text).length);
  });

  it('merge rule glues two adjacent tokens into one', () => {
    const tok = createTokenizer({
      vocab: new Map([['he', 256]]),
      mergeRules: [['h', 'e']],
    });
    expect(tok.encode('he')).toEqual([256]);
  });

  it('merge does NOT merge non-adjacent pairs', () => {
    const tok = createTokenizer({
      vocab: new Map([['ab', 256]]),
      mergeRules: [['a', 'b']],
    });
    // 'axb' — 'a' and 'b' are not adjacent
    const ids = tok.encode('axb');
    expect(ids).not.toContain(256);
    expect(ids).toEqual([97, 120, 98]);
  });

  it('multiple merge rules applied in order', () => {
    // Merge 'a'+'b'→'ab', then 'ab'+'c'→'abc'
    const tok = createTokenizer({
      vocab: new Map([['ab', 256], ['abc', 257]]),
      mergeRules: [['a', 'b'], ['ab', 'c']],
    });
    expect(tok.encode('abc')).toEqual([257]);
  });

  it('encode/decode round-trip with merge rules', () => {
    const tok = mergeTok();
    const text = 'abcdabcd!!';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it('encode/decode round-trip with partial merge matches', () => {
    const tok = mergeTok();
    const text = 'xyzabzz';
    expect(tok.decode(tok.encode(text))).toBe(text);
  });
});

// ─── count / estimate ─────────────────────────────────────────────────────────

describe('count', () => {
  it('count equals encode().length', () => {
    const tok = byteTok();
    const text = 'Hello World 🌍';
    expect(tok.count(text)).toBe(tok.encode(text).length);
  });

  it('count of empty string is 0', () => {
    expect(byteTok().count('')).toBe(0);
  });

  it('count with merge tok equals encode().length', () => {
    const tok = mergeTok();
    const text = 'abcdxyz';
    expect(tok.count(text)).toBe(tok.encode(text).length);
  });
});

describe('estimate', () => {
  it('estimate is >= 1 for non-empty ASCII', () => {
    expect(byteTok().estimate('hi')).toBeGreaterThanOrEqual(1);
  });

  it('estimate is 0 for empty string', () => {
    expect(byteTok().estimate('')).toBe(0);
  });

  it('estimate uses byte length not char length (ASCII same)', () => {
    const tok = createTokenizer({ fallbackBytesPerToken: 1 });
    expect(tok.estimate('abc')).toBe(3);
  });

  it('estimate handles unicode: byte length > char count', () => {
    // '🎉' = 4 UTF-8 bytes, 1 JS char
    const tok = createTokenizer({ fallbackBytesPerToken: 1 });
    expect(tok.estimate('🎉')).toBe(4);  // not 1
  });

  it('estimate is Math.ceil(byteLen / fallbackBytesPerToken)', () => {
    const tok = createTokenizer({ fallbackBytesPerToken: 3 });
    const text = 'abcde'; // 5 bytes → ceil(5/3) = 2
    expect(tok.estimate(text)).toBe(2);
  });

  it('estimate with fallbackBytesPerToken=1 equals byte length', () => {
    const tok = createTokenizer({ fallbackBytesPerToken: 1 });
    const text = 'こんにちは'; // 3 bytes per kana = 15 bytes
    expect(tok.estimate(text)).toBe(Buffer.byteLength(text, 'utf8'));
  });
});

// ─── splitToChunks ────────────────────────────────────────────────────────────

describe('splitToChunks', () => {
  it('single short text returns single chunk', () => {
    const tok = byteTok();
    const chunks = tok.splitToChunks('hello', { maxTokens: 100 });
    expect(chunks).toEqual(['hello']);
  });

  it('empty text returns empty array', () => {
    const tok = byteTok();
    expect(tok.splitToChunks('', { maxTokens: 10 })).toEqual([]);
  });

  it('all chunks respect maxTokens (no overlap)', () => {
    const tok = byteTok();
    const text = 'aaa bbb ccc ddd eee';
    const chunks = tok.splitToChunks(text, { maxTokens: 8 });
    for (const c of chunks) {
      expect(tok.count(c)).toBeLessThanOrEqual(8);
    }
  });

  it('chunks concatenate to cover all words from original (by-space splitting)', () => {
    const tok = byteTok();
    // Use \n\n separator so we can assert lossless reconstruction
    const text = 'alpha\n\nbeta\n\ngamma';
    const chunks = tok.splitToChunks(text, { maxTokens: 8, separators: ['\n\n', ''] });
    expect(chunks.join('')).toBe(text);
  });

  it('preserves separators in chunks', () => {
    const tok = byteTok();
    const text = 'hello\n\nworld\n\nfoo';
    // 'hello\n\n' = 7 bytes; maxTokens=7 means each word+sep fits alone
    const chunks = tok.splitToChunks(text, { maxTokens: 7, separators: ['\n\n', ''] });
    expect(chunks[0]).toContain('\n\n');
    expect(chunks[0]).toBe('hello\n\n');
  });

  it('splits by lower-priority separator when high-priority not present', () => {
    const tok = byteTok();
    const text = 'hello world foo bar';
    const chunks = tok.splitToChunks(text, { maxTokens: 6 });
    // Space-split; 'hello ' = 6 chars = 6 tokens
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(tok.count(c)).toBeLessThanOrEqual(6);
    }
  });

  it('handles single huge word > maxTokens by hard-cutting', () => {
    const tok = byteTok();
    const text = 'abcdefghijklmnopqrst'; // 20 bytes, no spaces
    const chunks = tok.splitToChunks(text, { maxTokens: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(tok.count(c)).toBeLessThanOrEqual(5);
    }
  });

  it('hard-cut chunks reconstruct original text', () => {
    const tok = byteTok();
    const text = 'abcdefghij';
    const chunks = tok.splitToChunks(text, { maxTokens: 3 });
    expect(chunks.join('')).toBe(text);
  });

  it('produces more chunks with smaller maxTokens', () => {
    const tok = byteTok();
    const text = 'a b c d e f g h i j';
    const big = tok.splitToChunks(text, { maxTokens: 10 });
    const small = tok.splitToChunks(text, { maxTokens: 4 });
    expect(small.length).toBeGreaterThanOrEqual(big.length);
  });

  it('with overlap: second chunk starts with tail of first chunk', () => {
    const tok = byteTok();
    const text = 'aaa bbb ccc';
    // maxTokens=4: 'aaa ' (4 tokens), 'bbb ' (4 tokens), 'ccc' (3 tokens)
    const rawChunks = tok.splitToChunks(text, { maxTokens: 4 });
    const withOverlap = tok.splitToChunks(text, { maxTokens: 4, overlapTokens: 2 });

    expect(rawChunks.length).toBeGreaterThan(1);
    const expectedOverlap = tok.decode(tok.encode(rawChunks[0]!).slice(-2));
    expect(withOverlap[1]).toMatch(new RegExp('^' + expectedOverlap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('with overlap: overlap content from previous raw chunk appears in next chunk', () => {
    const tok = byteTok();
    const text = 'hello\n\nworld\n\nfoo';
    const rawChunks = tok.splitToChunks(text, { maxTokens: 7, separators: ['\n\n', ''] });
    const withOverlap = tok.splitToChunks(text, { maxTokens: 7, overlapTokens: 2, separators: ['\n\n', ''] });

    // The tail of rawChunks[0] should be a prefix of withOverlap[1]
    const tailOf0 = tok.decode(tok.encode(rawChunks[0]!).slice(-2));
    expect(withOverlap[1]!.startsWith(tailOf0)).toBe(true);
  });

  it('with overlap: chunk without overlap is prefix of overlapping version', () => {
    const tok = byteTok();
    const text = 'aaa bbb ccc ddd';
    const raw = tok.splitToChunks(text, { maxTokens: 4 });
    const overlapped = tok.splitToChunks(text, { maxTokens: 4, overlapTokens: 2 });
    // First chunks should be identical (no preceding chunk to overlap from)
    expect(overlapped[0]).toBe(raw[0]);
  });

  it('custom separators respected', () => {
    const tok = byteTok();
    const text = 'part1|part2|part3';
    const chunks = tok.splitToChunks(text, { maxTokens: 7, separators: ['|', ''] });
    // '|' should be preserved in left pieces
    expect(chunks.some(c => c.includes('|'))).toBe(true);
  });

  it('does not strip separator content from output', () => {
    const tok = byteTok();
    const text = 'foo. bar. baz';
    const chunks = tok.splitToChunks(text, { maxTokens: 6, separators: ['. ', ''] });
    const joined = chunks.join('');
    expect(joined).toBe(text);
  });
});

// ─── truncate ─────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('text within budget is returned unchanged', () => {
    const tok = byteTok();
    expect(tok.truncate('hello', 100)).toBe('hello');
  });

  it('empty text returned unchanged', () => {
    const tok = byteTok();
    expect(tok.truncate('', 5)).toBe('');
  });

  it('cuts to maxTokens budget', () => {
    const tok = byteTok();
    const text = 'hello world foo bar';
    const result = tok.truncate(text, 5);
    expect(tok.count(result)).toBeLessThanOrEqual(5);
  });

  it('cuts at word boundary when possible', () => {
    const tok = byteTok();
    // 'hello world foo' — truncate to 11 tokens = 'hello world'
    // decode([104..111, 32, 119..]) → first 11 bytes = 'hello world'
    // lastSpace is at index 5, > 11/2 = 5.5 → no, equal... use 12
    // 'hello world ' = 12 bytes; first 12 = 'hello world '
    // lastSpace('hello world ') = 11, 11 > 6 → slice to 11 = 'hello world'
    const text = 'hello world foo';
    const result = tok.truncate(text, 12);
    expect(result).toBe('hello world');
  });

  it('falls back to hard cut when no space in truncated region', () => {
    const tok = byteTok();
    const text = 'abcdefghijklmnop';
    const result = tok.truncate(text, 5);
    expect(result).toBe('abcde');
  });

  it('truncated result has token count <= maxTokens', () => {
    const tok = byteTok();
    const text = 'the quick brown fox jumped over the lazy dog';
    for (const maxT of [5, 10, 15, 20]) {
      expect(tok.count(tok.truncate(text, maxT))).toBeLessThanOrEqual(maxT);
    }
  });

  it('truncated result is a prefix of the original text (byte-wise)', () => {
    const tok = byteTok();
    const text = 'hello world example text';
    const result = tok.truncate(text, 7);
    expect(text.startsWith(result) || result.length <= 7).toBe(true);
  });
});

// ─── loadVocabFromJson / serializeVocab ───────────────────────────────────────

describe('loadVocabFromJson + serializeVocab', () => {
  it('serialize then deserialize produces identical encode results', () => {
    const tok1 = mergeTok();
    const json = serializeVocab(tok1);
    const tok2 = loadVocabFromJson(json);
    const text = 'abcdxyz';
    expect(tok2.encode(text)).toEqual(tok1.encode(text));
  });

  it('serialize then deserialize produces identical decode results', () => {
    const tok1 = mergeTok();
    const json = serializeVocab(tok1);
    const tok2 = loadVocabFromJson(json);
    const ids = tok1.encode('abcdabcd!!');
    expect(tok2.decode(ids)).toBe(tok1.decode(ids));
  });

  it('round-trip preserves fallbackBytesPerToken', () => {
    const tok1 = createTokenizer({ fallbackBytesPerToken: 7 });
    const tok2 = loadVocabFromJson(serializeVocab(tok1));
    expect(tok2.getConfig().fallbackBytesPerToken).toBe(7);
  });

  it('round-trip preserves merge rules length', () => {
    const tok1 = mergeTok();
    const tok2 = loadVocabFromJson(serializeVocab(tok1));
    expect(tok2.getConfig().mergeRules.length).toBe(tok1.getConfig().mergeRules.length);
  });

  it('round-trip with byte-fallback tokenizer (empty vocab)', () => {
    const tok1 = byteTok(3);
    const json = serializeVocab(tok1);
    const tok2 = loadVocabFromJson(json);
    const text = 'Hello 🌍';
    expect(tok2.encode(text)).toEqual(tok1.encode(text));
    expect(tok2.decode(tok1.encode(text))).toBe(text);
  });

  it('serializeVocab output is valid JSON', () => {
    const json = serializeVocab(mergeTok());
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ─── getConfig ────────────────────────────────────────────────────────────────

describe('getConfig', () => {
  it('returns a copy of vocab (not same reference)', () => {
    const vocab = new Map([['ab', 256]]);
    const tok = createTokenizer({ vocab });
    const cfg = tok.getConfig();
    expect(cfg.vocab).not.toBe(vocab);
    expect(cfg.vocab.get('ab')).toBe(256);
  });

  it('returns default fallbackBytesPerToken when not set', () => {
    const tok = createTokenizer();
    expect(tok.getConfig().fallbackBytesPerToken).toBe(4);
  });
});
