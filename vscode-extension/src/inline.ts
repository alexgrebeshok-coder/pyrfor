/**
 * inline.ts — Ghost-text / inline suggestion engine (Sprint 2 #3).
 *
 * Pure Node module — no 'vscode' import. The VSCode glue registers an
 * InlineCompletionItemProvider that wraps this engine:
 *
 * @example
 * ```ts
 * // vscode glue (not in this file):
 * import * as vscode from 'vscode';
 * import { InlineEngine, classifyTrigger } from './inline';
 *
 * const engine = new InlineEngine({ daemon: adaptedClient });
 *
 * vscode.languages.registerInlineCompletionItemProvider('*', {
 *   async provideInlineCompletionItems(document, position, context) {
 *     const offset = document.offsetAt(position);
 *     const prevChar = document.getText(new vscode.Range(
 *       position.translate(0, -1), position,
 *     ));
 *     const req = {
 *       docId: document.uri.toString(),
 *       languageId: document.languageId,
 *       fullText: document.getText(),
 *       cursorOffset: offset,
 *       triggerKind: context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke
 *         ? 'manual' : classifyTrigger(prevChar, engine.triggerCharacters),
 *     };
 *     const suggestion = await engine.request(req);
 *     if (!suggestion) return [];
 *     return [new vscode.InlineCompletionItem(suggestion.text)];
 *   },
 * });
 * ```
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface InlineRequest {
  /** Stable identifier per file (e.g. URI string). */
  docId: string;
  /** E.g. 'typescript', 'python'. */
  languageId: string;
  fullText: string;
  /** 0-based character offset in fullText. */
  cursorOffset: number;
  triggerKind: 'auto' | 'manual';
  /** Number of lines of context to send. Default 80. */
  contextWindowLines?: number;
  /** Max tokens the model may generate. Default 64. */
  maxSuggestionTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface InlineSuggestion {
  /** sha256 of (docId + cursorOffset + text). */
  id: string;
  text: string;
  /** By default startOffset === endOffset === cursorOffset (pure insertion). */
  range: { startOffset: number; endOffset: number };
  /** 0..1 */
  confidence: number;
  model?: string;
  provider?: string;
}

/**
 * Structural interface matching the public surface of DaemonClient.
 * Use an adapter to bridge the DaemonClient (which has a lower-level
 * `send(msg: object): void` + EventEmitter) to this promise-based surface.
 */
export interface DaemonClientLike {
  send(type: string, payload: unknown): Promise<unknown>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  isConnected(): boolean;
}

export interface InlineEngineOptions {
  /** Must implement DaemonClientLike. */
  daemon: DaemonClientLike;
  /** Debounce interval for external callers. Default 120 ms. */
  debounceMs?: number;
  /** Suppress suggestions while typing faster than this. Default 80 ms. */
  minIdleMs?: number;
  /** Characters that auto-trigger suggestions. Default: ['.','(', ...']. */
  triggerCharacters?: string[];
  /** LRU cache capacity (keyed by docId+prefixHash). Default 64. */
  cacheSize?: number;
  /** Master on/off switch. Default true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Slice up to `lines` lines of text centred around `offset`.
 * Never overflows file boundaries.
 */
export function sliceContextAround(
  text: string,
  offset: number,
  lines: number,
): { snippet: string; startLine: number; endLine: number } {
  const allLines = text.split('\n');
  const clampedOffset = Math.max(0, Math.min(offset, text.length));
  // Count newlines before cursor to derive cursor line.
  const cursorLine = text.slice(0, clampedOffset).split('\n').length - 1;

  const half = Math.floor(lines / 2);
  const startLine = Math.max(0, cursorLine - half);
  const endLine = Math.min(allLines.length - 1, startLine + lines - 1);

  return {
    snippet: allLines.slice(startLine, endLine + 1).join('\n'),
    startLine,
    endLine,
  };
}

/**
 * sha256 of the last 200 characters before `offset`.
 * Two requests with identical recent context share a prefix hash.
 */
export function computePrefixHash(text: string, offset: number): string {
  const prefix = text.slice(Math.max(0, offset - 200), offset);
  return createHash('sha256').update(prefix).digest('hex');
}

/** sha256 of (docId + ':' + offset + ':' + suggestion text). */
export function computeSuggestionId(
  docId: string,
  offset: number,
  suggestion: string,
): string {
  return createHash('sha256')
    .update(`${docId}:${offset}:${suggestion}`)
    .digest('hex');
}

/**
 * Returns 'auto' if `prevChar` is in `triggerCharacters`, 'none' otherwise.
 */
export function classifyTrigger(
  prevChar: string | undefined,
  triggerCharacters: string[],
): 'auto' | 'none' {
  if (prevChar === undefined) return 'none';
  return triggerCharacters.includes(prevChar) ? 'auto' : 'none';
}

/**
 * Convert raw daemon completion metadata to a 0..1 confidence score.
 * Defaults to 0.5 when no signal is available.
 *
 * - `finishReason === 'stop'` → high base confidence (0.8)
 * - `logprob` (negative, natural-log probability) → converted via e^logprob
 * - Both present → averaged
 */
export function estimateConfidence(raw: {
  logprob?: number;
  finishReason?: string;
}): number {
  if (raw.logprob === undefined && raw.finishReason === undefined) {
    return 0.5;
  }

  let base = 0.5;
  if (raw.finishReason === 'stop') {
    base = 0.8;
  } else if (raw.finishReason !== undefined) {
    base = 0.3;
  }

  if (raw.logprob !== undefined) {
    const prob = Math.min(1, Math.max(0, Math.exp(raw.logprob)));
    base = (base + prob) / 2;
  }

  return Math.min(1, Math.max(0, base));
}

// ---------------------------------------------------------------------------
// Internal LRU cache
// ---------------------------------------------------------------------------

class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map: Map<K, V> = new Map();

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    // Re-insert at tail (most-recently-used end).
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict least-recently-used (head of Map insertion order).
      const lruKey = this.map.keys().next().value as K;
      this.map.delete(lruKey);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Raw daemon response shape (internal)
// ---------------------------------------------------------------------------

interface RawSuggestion {
  text?: string;
  logprob?: number;
  finishReason?: string;
  model?: string;
  provider?: string;
  range?: { startOffset: number; endOffset: number };
}

// ---------------------------------------------------------------------------
// InlineEngine
// ---------------------------------------------------------------------------

export class InlineEngine {
  /** Publicly readable list of active trigger characters. */
  readonly triggerCharacters: string[];

  private readonly _daemon: DaemonClientLike;
  private readonly _minIdleMs: number;
  private readonly _debounceMs: number;
  private _enabled: boolean;

  private readonly _cache: LRUCache<string, InlineSuggestion>;
  /** Maps suggestion.id → cache key so accept/reject can locate the entry. */
  private readonly _suggestionToKey = new Map<string, string>();

  private _hits = 0;
  private _misses = 0;

  constructor(opts: InlineEngineOptions) {
    this._daemon = opts.daemon;
    this._minIdleMs = opts.minIdleMs ?? 80;
    this._debounceMs = opts.debounceMs ?? 120;
    this.triggerCharacters = opts.triggerCharacters ?? [
      '.', '(', ',', ' ', '\n', '/', '<', '>',
    ];
    this._enabled = opts.enabled ?? true;
    this._cache = new LRUCache<string, InlineSuggestion>(opts.cacheSize ?? 64);
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Request a single (cached) inline suggestion.
   *
   * Returns `null` when:
   * - Engine is disabled
   * - Daemon returns no candidates
   * - Daemon throws (error is swallowed and logged)
   */
  async request(req: InlineRequest): Promise<InlineSuggestion | null> {
    if (!this._enabled) return null;

    const prefixHash = computePrefixHash(req.fullText, req.cursorOffset);
    const cacheKey = `${req.docId}:${prefixHash}`;

    const cached = this._cache.get(cacheKey);
    if (cached !== undefined) {
      this._hits++;
      return cached;
    }
    this._misses++;

    try {
      const suggestions = await this._fetchSuggestions(req);
      if (suggestions.length === 0) return null;

      const first = suggestions[0];
      this._cache.set(cacheKey, first);
      this._suggestionToKey.set(first.id, cacheKey);
      return first;
    } catch (err) {
      console.warn('[InlineEngine] request failed:', err);
      return null;
    }
  }

  /** Multi-suggestion variant. Not cached. Returns [] on error or disabled. */
  async suggest(req: InlineRequest): Promise<InlineSuggestion[]> {
    if (!this._enabled) return [];
    try {
      return await this._fetchSuggestions(req);
    } catch (err) {
      console.warn('[InlineEngine] suggest failed:', err);
      return [];
    }
  }

  /** Notify daemon that user accepted a suggestion; bumps cached confidence. */
  accept(suggestion: InlineSuggestion, ctx: { docId: string }): void {
    void this._daemon.send('inline.accepted', {
      id: suggestion.id,
      docId: ctx.docId,
    });
    const key = this._suggestionToKey.get(suggestion.id);
    if (key !== undefined) {
      const cached = this._cache.get(key);
      if (cached !== undefined) {
        this._cache.set(key, {
          ...cached,
          confidence: Math.min(1, cached.confidence + 0.1),
        });
      }
    }
  }

  /** Notify daemon that user rejected a suggestion; evicts from cache. */
  reject(suggestion: InlineSuggestion, ctx: { docId: string }): void {
    void this._daemon.send('inline.rejected', {
      id: suggestion.id,
      docId: ctx.docId,
    });
    const key = this._suggestionToKey.get(suggestion.id);
    if (key !== undefined) {
      this._cache.delete(key);
      this._suggestionToKey.delete(suggestion.id);
    }
  }

  /**
   * Decide whether to fire a suggestion request.
   *
   * Returns `false` when:
   * - Engine disabled
   * - User is typing faster than `minIdleMs`
   */
  shouldTrigger(req: InlineRequest, lastKeystrokeMs: number): boolean {
    if (!this._enabled) return false;
    if (Date.now() - lastKeystrokeMs < this._minIdleMs) return false;
    // triggerKind 'manual' always fires; 'auto' defers to caller's char check.
    return true;
  }

  enable(): void {
    this._enabled = true;
  }

  disable(): void {
    this._enabled = false;
  }

  clearCache(): void {
    this._cache.clear();
    this._suggestionToKey.clear();
    this._hits = 0;
    this._misses = 0;
  }

  getCacheStats(): { size: number; hits: number; misses: number } {
    return { size: this._cache.size, hits: this._hits, misses: this._misses };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _fetchSuggestions(
    req: InlineRequest,
  ): Promise<InlineSuggestion[]> {
    const contextWindowLines = req.contextWindowLines ?? 80;
    const { snippet, startLine, endLine } = sliceContextAround(
      req.fullText,
      req.cursorOffset,
      contextWindowLines,
    );

    const response = await this._daemon.send('inline.complete', {
      docId: req.docId,
      languageId: req.languageId,
      snippet,
      startLine,
      endLine,
      cursorOffset: req.cursorOffset,
      triggerKind: req.triggerKind,
      maxSuggestionTokens: req.maxSuggestionTokens ?? 64,
      metadata: req.metadata,
    });

    return this._parseSuggestions(response, req);
  }

  private _parseSuggestions(
    response: unknown,
    req: InlineRequest,
  ): InlineSuggestion[] {
    let rawList: RawSuggestion[];
    if (Array.isArray(response)) {
      rawList = response as RawSuggestion[];
    } else if (
      response !== null &&
      typeof response === 'object' &&
      Array.isArray((response as Record<string, unknown>).suggestions)
    ) {
      rawList = (response as Record<string, unknown>)
        .suggestions as RawSuggestion[];
    } else {
      rawList = [];
    }

    return rawList
      .filter((raw) => typeof raw.text === 'string' && raw.text.length > 0)
      .map((raw) => ({
        id: computeSuggestionId(req.docId, req.cursorOffset, raw.text!),
        text: raw.text!,
        range: raw.range ?? {
          startOffset: req.cursorOffset,
          endOffset: req.cursorOffset,
        },
        confidence: estimateConfidence({
          logprob: raw.logprob,
          finishReason: raw.finishReason,
        }),
        model: raw.model,
        provider: raw.provider,
      }));
  }

  /** Exposed for testing / VSCode glue reference. */
  get debounceMs(): number {
    return this._debounceMs;
  }
}
