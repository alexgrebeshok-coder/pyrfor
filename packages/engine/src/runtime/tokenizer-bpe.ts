/**
 * tokenizer-bpe.ts — Self-contained BPE-style tokenizer + token estimator + chunk splitter
 * for LLM token-budget management. Uses deterministic synthetic BPE with byte-fallback.
 *
 * IDs 0–255 are always reserved for raw bytes (fallback).
 * Vocab IDs start at 256+.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TokenizerConfig {
  vocab?: Map<string, number>;
  mergeRules?: Array<[string, string]>;
  fallbackBytesPerToken?: number;
}

export interface SplitOptions {
  maxTokens: number;
  overlapTokens?: number;
  separators?: string[];
}

export interface Tokenizer {
  encode(text: string): number[];
  decode(ids: number[]): string;
  count(text: string): number;
  estimate(text: string): number;
  splitToChunks(text: string, opts: SplitOptions): string[];
  truncate(text: string, maxTokens: number): string;
  getConfig(): Required<TokenizerConfig>;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Apply one BPE merge rule to the token sequence (greedy left-to-right). */
function applyMerge(seq: string[], a: string, b: string): string[] {
  const merged = a + b;
  const result: string[] = [];
  let i = 0;
  while (i < seq.length) {
    if (i + 1 < seq.length && seq[i] === a && seq[i + 1] === b) {
      result.push(merged);
      i += 2;
    } else {
      result.push(seq[i]!);
      i++;
    }
  }
  return result;
}

/** Convert a token string (internal byte-space) back to raw byte values. */
function tokenToBytes(token: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i);
    if (code < 256) {
      bytes.push(code);
    } else {
      // Unicode char ended up in a merge token — encode to UTF-8 bytes
      const buf = Buffer.from(token[i]!, 'utf8');
      for (const b of buf) bytes.push(b);
    }
  }
  return bytes;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createTokenizer(config: TokenizerConfig = {}): Tokenizer {
  const vocab: Map<string, number> = config.vocab ?? new Map();
  const mergeRules: Array<[string, string]> = config.mergeRules ?? [];
  const fallbackBytesPerToken: number = config.fallbackBytesPerToken ?? 4;

  // Pre-build reverse vocab map for decode
  const revVocab = new Map<number, string>();
  for (const [token, id] of vocab) {
    revVocab.set(id, token);
  }

  // ── encode ─────────────────────────────────────────────────────────────────

  function encode(text: string): number[] {
    if (text.length === 0) return [];

    // Step 1: UTF-8 bytes → single-char strings in byte space
    const rawBytes = Array.from(Buffer.from(text, 'utf8'));
    let seq: string[] = rawBytes.map(b => String.fromCharCode(b));

    // Step 2: apply all merge rules in order
    for (const [a, b] of mergeRules) {
      seq = applyMerge(seq, a, b);
    }

    // Step 3: map tokens → IDs
    const ids: number[] = [];
    for (const token of seq) {
      if (vocab.has(token)) {
        ids.push(vocab.get(token)!);
      } else if (token.length === 1 && token.charCodeAt(0) < 256) {
        // Single byte fallback (IDs 0–255)
        ids.push(token.charCodeAt(0));
      } else {
        // Unknown multi-char token: emit individual byte IDs
        for (const b of tokenToBytes(token)) ids.push(b);
      }
    }
    return ids;
  }

  // ── decode ─────────────────────────────────────────────────────────────────

  function decode(ids: number[]): string {
    const byteValues: number[] = [];
    for (const id of ids) {
      if (id >= 0 && id <= 255) {
        byteValues.push(id);
      } else if (revVocab.has(id)) {
        for (const b of tokenToBytes(revVocab.get(id)!)) byteValues.push(b);
      }
      // Unknown IDs > 255 not in vocab: silently skip
    }
    return Buffer.from(byteValues).toString('utf8');
  }

  // ── count / estimate ───────────────────────────────────────────────────────

  function count(text: string): number {
    return encode(text).length;
  }

  function estimate(text: string): number {
    if (text.length === 0) return 0;
    const byteLen = Buffer.byteLength(text, 'utf8');
    return Math.ceil(byteLen / fallbackBytesPerToken);
  }

  // ── splitToChunks ──────────────────────────────────────────────────────────

  /** Return the last `n` token-ids' worth of decoded text from `text`. */
  function overlapTail(text: string, n: number): string {
    if (n <= 0) return '';
    const ids = encode(text);
    if (ids.length <= n) return text;
    return decode(ids.slice(-n));
  }

  /** Hard-cut `text` into slices of at most `maxToks` tokens. */
  function hardCut(text: string, maxToks: number): string[] {
    const ids = encode(text);
    const result: string[] = [];
    for (let i = 0; i < ids.length; i += maxToks) {
      const chunk = decode(ids.slice(i, i + maxToks));
      if (chunk.length > 0) result.push(chunk);
    }
    return result.length > 0 ? result : [text];
  }

  /**
   * Recursively split `text` using `seps` in priority order, then greedily
   * merge small pieces into chunks that fit within `maxToks`.
   */
  function splitBySeps(text: string, seps: string[], maxToks: number): string[] {
    if (count(text) <= maxToks) return [text];

    // Ensure a hard-cut fallback is always available
    const effectiveSeps = seps[seps.length - 1] === '' ? seps : [...seps, ''];

    for (let si = 0; si < effectiveSeps.length; si++) {
      const sep = effectiveSeps[si]!;

      if (sep === '') {
        return hardCut(text, maxToks);
      }

      if (!text.includes(sep)) continue;

      // Split keeping separator attached to the left piece
      const rawParts = text.split(sep);
      const pieces: string[] = [];
      for (let i = 0; i < rawParts.length; i++) {
        const part = i < rawParts.length - 1 ? rawParts[i]! + sep : rawParts[i]!;
        if (part.length > 0) pieces.push(part);
      }

      if (pieces.length <= 1) continue;

      const remainingSeps = effectiveSeps.slice(si + 1);

      // Recursively reduce any piece that is still too large
      const small: string[] = [];
      for (const piece of pieces) {
        if (count(piece) <= maxToks) {
          small.push(piece);
        } else {
          small.push(...splitBySeps(piece, remainingSeps, maxToks));
        }
      }

      // Greedy merge
      const chunks: string[] = [];
      let current = '';
      for (const piece of small) {
        const candidate = current + piece;
        if (count(candidate) <= maxToks) {
          current = candidate;
        } else {
          if (current.length > 0) chunks.push(current);
          current = piece;
        }
      }
      if (current.length > 0) chunks.push(current);

      return chunks;
    }

    // Should never reach here with a well-formed seps list
    return hardCut(text, maxToks);
  }

  function splitToChunks(text: string, opts: SplitOptions): string[] {
    const {
      maxTokens,
      overlapTokens = 0,
      separators = ['\n\n', '\n', '. ', ' ', ''],
    } = opts;

    if (text.length === 0) return [];

    const rawChunks = splitBySeps(text, separators, maxTokens);

    if (overlapTokens <= 0) return rawChunks;

    // Prepend tail of previous chunk as overlap into each subsequent chunk
    const result: string[] = [rawChunks[0]!];
    for (let i = 1; i < rawChunks.length; i++) {
      const overlap = overlapTail(rawChunks[i - 1]!, overlapTokens);
      result.push(overlap + rawChunks[i]!);
    }
    return result;
  }

  // ── truncate ───────────────────────────────────────────────────────────────

  function truncate(text: string, maxTokens: number): string {
    if (text.length === 0) return text;
    const ids = encode(text);
    if (ids.length <= maxTokens) return text;

    const truncated = decode(ids.slice(0, maxTokens));

    // Attempt word-boundary break: only use it if the space is in the second half
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 0 && lastSpace > truncated.length / 2) {
      return truncated.slice(0, lastSpace);
    }
    return truncated;
  }

  // ── getConfig ──────────────────────────────────────────────────────────────

  function getConfig(): Required<TokenizerConfig> {
    return {
      vocab: new Map(vocab),
      mergeRules: mergeRules.map(r => [r[0]!, r[1]!] as [string, string]),
      fallbackBytesPerToken,
    };
  }

  return { encode, decode, count, estimate, splitToChunks, truncate, getConfig };
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

/** Deserialize a tokenizer from JSON produced by {@link serializeVocab}. */
export function loadVocabFromJson(json: string): Tokenizer {
  const data = JSON.parse(json) as {
    vocab?: Record<string, number>;
    mergeRules?: [string, string][];
    fallbackBytesPerToken?: number;
  };
  return createTokenizer({
    vocab: data.vocab ? new Map(Object.entries(data.vocab)) : undefined,
    mergeRules: data.mergeRules,
    fallbackBytesPerToken: data.fallbackBytesPerToken,
  });
}

/** Serialize a tokenizer's config to a JSON string for persistence. */
export function serializeVocab(tok: Tokenizer): string {
  const cfg = tok.getConfig();
  return JSON.stringify({
    vocab: Object.fromEntries(cfg.vocab),
    mergeRules: cfg.mergeRules,
    fallbackBytesPerToken: cfg.fallbackBytesPerToken,
  });
}
