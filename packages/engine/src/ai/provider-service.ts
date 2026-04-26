/**
 * provider-service.ts — Thin facade in front of the LLM provider router.
 *
 * Provides a single, mockable, contract-stable API for "send a chat completion"
 * to the rest of the engine (FreeClaude mode, slash commands, VSCode extension,
 * MCP adapter).
 *
 * RouterLike is derived from the actual public surface of
 * packages/engine/src/runtime/llm-provider-router.ts.
 *
 * Mapping:
 *   RouterLike.call(LlmRequest, opts?)  →  wraps LlmProviderRouter.call()
 *   RouterLike.listProviders?()         →  wraps LlmProviderRouter.listProviders()
 *
 *   ChatRequest  → LlmRequest
 *     messages              → messages (role+content forwarded; extra fields preserved)
 *     temperature           → temperature
 *     maxTokens             → maxTokens
 *     tools                 → tools
 *     signal                → signal
 *     modelProfile==='fast' → preferCheapFor='simple'; otherwise 'complex'
 *     providerHint          → opts.order=[providerHint]
 *     stop, metadata        → not forwarded (no slot in LlmRequest)
 *
 *   LlmResponse → ChatResponse
 *     text       → content
 *     provider   → provider
 *     toolCalls  → toolCalls  (normalised to {id,name,arguments})
 *     usage      → usage      (totalTokens added; fallback to estimateUsage)
 *     latencyMs  → latencyMs  (re-measured by service; router value ignored)
 */

import { logger } from '../observability/logger';
import type { LlmRequest, LlmResponse, ProviderStatus } from '../runtime/llm-provider-router';

// ====== Public Types ======================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Opaque label routed by the underlying router: 'fast' | 'balanced' | 'reasoning' */
  modelProfile?: string;
  /** Optional preferred provider name */
  providerHint?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{ name: string; description?: string; parameters?: unknown }>;
  stop?: string[];
  /** Passed through to ledger / caller; not forwarded to the router */
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  model: string;
  provider: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  latencyMs: number;
}

/** Mockable facade for the engine's chat-completion surface */
export interface ProviderClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
  listProviders(): Array<{ name: string; available: boolean }>;
}

// ====== RouterLike — structural mirror of LlmProviderRouter ===============
//
// Source: packages/engine/src/runtime/llm-provider-router.ts
//   LlmProviderRouter.call(req: LlmRequest, opts?) → Promise<LlmResponse>
//   LlmProviderRouter.listProviders()              → ProviderStatus[]
//
// Only the methods consumed by ProviderService are required.

export interface RouterLike {
  call(
    req: LlmRequest,
    opts?: { order?: string[]; maxAttempts?: number },
  ): Promise<LlmResponse>;
  listProviders?(): ProviderStatus[];
}

// ====== Pure Helpers ======================================================

/**
 * Classify an error for retry decisions.
 *   - AbortError name      → 'cancelled'
 *   - Network / 5xx codes  → 'transient'
 *   - Everything else      → 'permanent'
 */
export function classifyError(e: unknown): 'transient' | 'permanent' | 'cancelled' {
  // DOMException does not always extend Error in older jsdom / some environments;
  // handle it explicitly before the instanceof Error guard.
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return e.name === 'AbortError' ? 'cancelled' : 'permanent';
  }
  if (!(e instanceof Error)) return 'permanent';
  if (e.name === 'AbortError') return 'cancelled';

  const msg = e.message.toLowerCase();

  const transientPatterns = [
    'econnreset',
    'fetch failed',
    'network',
    'econnrefused',
    'etimedout',
    'socket hang up',
    'timeout',
    '503',
    '504',
    '502',
    'overload',
    'rate limit',
    '429',
    'service unavailable',
  ];

  if (transientPatterns.some(p => msg.includes(p))) return 'transient';
  return 'permanent';
}

/**
 * Strip messages with empty (or whitespace-only) content, but always preserve
 * tool messages regardless of content.  Original ordering is retained.
 */
export function normalizeMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.filter(msg => {
    if (msg.role === 'tool') return true;
    return msg.content.trim().length > 0;
  });
}

/**
 * Rough token estimate: 4 chars ≈ 1 token.
 * Used only as a fallback when the router does not return usage metadata.
 */
export function estimateUsage(
  req: ChatRequest,
  content: string,
): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const promptChars = req.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
  const completionTokens = Math.max(1, Math.ceil(content.length / 4));
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

// ====== Internal helpers ==================================================

function createAbortError(msg: string): Error {
  const e = new Error(msg);
  e.name = 'AbortError';
  return e;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeToolCalls(
  raw: unknown[] | undefined,
): Array<{ id: string; name: string; arguments: unknown }> | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((tc: any, i) => ({
    id: tc?.id ?? `tool_${i}`,
    name: tc?.name ?? tc?.function?.name ?? 'unknown',
    arguments: tc?.arguments ?? tc?.function?.arguments ?? {},
  }));
}

// ====== ProviderService ===================================================

export interface ProviderServiceOptions {
  router: RouterLike;
  defaultModelProfile?: string;
  defaultTimeoutMs?: number;
  retry?: {
    /** Total number of attempts (including the first). Default: 1 (no retry). */
    attempts?: number;
    /** Linear backoff base in ms: wait = attempt * backoffMs. Default: 500. */
    backoffMs?: number;
  };
}

export class ProviderService implements ProviderClient {
  private readonly router: RouterLike;
  private readonly defaultModelProfile: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly errorListeners = new Set<(e: Error) => void>();

  constructor(opts: ProviderServiceOptions) {
    this.router = opts.router;
    this.defaultModelProfile = opts.defaultModelProfile ?? 'balanced';
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 60_000;
    this.maxAttempts = opts.retry?.attempts ?? 1;
    this.backoffMs = opts.retry?.backoffMs ?? 500;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Pre-flight: honour a signal that was already aborted before we start.
    if (req.signal?.aborted) {
      throw createAbortError('Request was aborted before it started');
    }

    const modelProfile = req.modelProfile ?? this.defaultModelProfile;
    const normalizedMsgs = normalizeMessages(req.messages);
    const preferCheapFor: 'simple' | 'complex' = modelProfile === 'fast' ? 'simple' : 'complex';

    const llmRequest: LlmRequest = {
      messages: normalizedMsgs.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.name !== undefined ? { name: m.name } : {}),
        ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
        ...(m.toolCalls !== undefined ? { toolCalls: m.toolCalls } : {}),
      })),
      tools: req.tools as any[],
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      preferCheapFor,
      signal: req.signal,
    };

    const routerOpts: { order?: string[] } = {};
    if (req.providerHint) routerOpts.order = [req.providerHint];

    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < this.maxAttempts) {
      if (attempt > 0) {
        await sleep(attempt * this.backoffMs);
      }
      attempt++;

      if (req.signal?.aborted) {
        throw createAbortError('Request was aborted');
      }

      const callStart = Date.now();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(createAbortError(`Provider call timed out after ${this.defaultTimeoutMs}ms`)),
            this.defaultTimeoutMs,
          );
        });

        let result: LlmResponse;
        try {
          result = await Promise.race([this.router.call(llmRequest, routerOpts), timeoutPromise]);
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }

        const latencyMs = Date.now() - callStart;
        const toolCalls = normalizeToolCalls(result.toolCalls);
        const finishReason: ChatResponse['finishReason'] =
          toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop';

        let usage: ChatResponse['usage'];
        if (result.usage) {
          const { promptTokens, completionTokens } = result.usage;
          usage = {
            promptTokens,
            completionTokens,
            totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
          };
        } else {
          usage = estimateUsage(req, result.text);
        }

        return {
          content: result.text,
          toolCalls,
          finishReason,
          model: modelProfile,
          provider: result.provider,
          usage,
          latencyMs,
        };
      } catch (err: unknown) {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        const error = err instanceof Error ? err : new Error(String(err));
        const kind = classifyError(error);

        this.emitError(error);

        if (kind === 'cancelled' || kind === 'permanent') throw error;

        // Transient — record and maybe retry.
        lastError = error;
        logger.warn(`[ProviderService] transient error on attempt ${attempt}/${this.maxAttempts}`, {
          error: error.message,
        });

        if (attempt >= this.maxAttempts) throw error;
      }
    }

    throw lastError ?? new Error('No attempts made');
  }

  listProviders(): Array<{ name: string; available: boolean }> {
    if (!this.router.listProviders) return [];
    return this.router.listProviders().map(p => ({ name: p.id, available: p.healthy }));
  }

  /** Subscribe to all errors (transient, permanent, cancelled).  Returns an unsubscribe fn. */
  onError(cb: (e: Error) => void): () => void {
    this.errorListeners.add(cb);
    return () => { this.errorListeners.delete(cb); };
  }

  private emitError(e: Error): void {
    this.errorListeners.forEach(cb => {
      try { cb(e); } catch { /* swallow listener errors */ }
    });
  }
}
