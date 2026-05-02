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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../observability/logger.js';
// ====== Pure Helpers ======================================================
/**
 * Classify an error for retry decisions.
 *   - AbortError name      → 'cancelled'
 *   - Network / 5xx codes  → 'transient'
 *   - Everything else      → 'permanent'
 */
export function classifyError(e) {
    // DOMException does not always extend Error in older jsdom / some environments;
    // handle it explicitly before the instanceof Error guard.
    if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
        return e.name === 'AbortError' ? 'cancelled' : 'permanent';
    }
    if (!(e instanceof Error))
        return 'permanent';
    if (e.name === 'AbortError')
        return 'cancelled';
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
    if (transientPatterns.some(p => msg.includes(p)))
        return 'transient';
    return 'permanent';
}
/**
 * Strip messages with empty (or whitespace-only) content, but always preserve
 * tool messages regardless of content.  Original ordering is retained.
 */
export function normalizeMessages(msgs) {
    return msgs.filter(msg => {
        if (msg.role === 'tool')
            return true;
        return msg.content.trim().length > 0;
    });
}
/**
 * Rough token estimate: 4 chars ≈ 1 token.
 * Used only as a fallback when the router does not return usage metadata.
 */
export function estimateUsage(req, content) {
    const promptChars = req.messages.reduce((sum, m) => { var _a, _b; return sum + ((_b = (_a = m.content) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0); }, 0);
    const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
    const completionTokens = Math.max(1, Math.ceil(content.length / 4));
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}
// ====== Internal helpers ==================================================
function createAbortError(msg) {
    const e = new Error(msg);
    e.name = 'AbortError';
    return e;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function normalizeToolCalls(raw) {
    if (!raw || raw.length === 0)
        return undefined;
    return raw.map((tc, i) => {
        var _a, _b, _c, _d, _e, _f, _g;
        return ({
            id: (_a = tc === null || tc === void 0 ? void 0 : tc.id) !== null && _a !== void 0 ? _a : `tool_${i}`,
            name: (_d = (_b = tc === null || tc === void 0 ? void 0 : tc.name) !== null && _b !== void 0 ? _b : (_c = tc === null || tc === void 0 ? void 0 : tc.function) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : 'unknown',
            arguments: (_g = (_e = tc === null || tc === void 0 ? void 0 : tc.arguments) !== null && _e !== void 0 ? _e : (_f = tc === null || tc === void 0 ? void 0 : tc.function) === null || _f === void 0 ? void 0 : _f.arguments) !== null && _g !== void 0 ? _g : {},
        });
    });
}
export class ProviderService {
    constructor(opts) {
        var _a, _b, _c, _d, _e, _f;
        this.errorListeners = new Set();
        this.router = opts.router;
        this.defaultModelProfile = (_a = opts.defaultModelProfile) !== null && _a !== void 0 ? _a : 'balanced';
        this.defaultTimeoutMs = (_b = opts.defaultTimeoutMs) !== null && _b !== void 0 ? _b : 60000;
        this.maxAttempts = (_d = (_c = opts.retry) === null || _c === void 0 ? void 0 : _c.attempts) !== null && _d !== void 0 ? _d : 1;
        this.backoffMs = (_f = (_e = opts.retry) === null || _e === void 0 ? void 0 : _e.backoffMs) !== null && _f !== void 0 ? _f : 500;
    }
    chat(req) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            // Pre-flight: honour a signal that was already aborted before we start.
            if ((_a = req.signal) === null || _a === void 0 ? void 0 : _a.aborted) {
                throw createAbortError('Request was aborted before it started');
            }
            const modelProfile = (_b = req.modelProfile) !== null && _b !== void 0 ? _b : this.defaultModelProfile;
            const normalizedMsgs = normalizeMessages(req.messages);
            const preferCheapFor = modelProfile === 'fast' ? 'simple' : 'complex';
            const llmRequest = {
                messages: normalizedMsgs.map(m => (Object.assign(Object.assign(Object.assign({ role: m.role, content: m.content }, (m.name !== undefined ? { name: m.name } : {})), (m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {})), (m.toolCalls !== undefined ? { toolCalls: m.toolCalls } : {})))),
                tools: req.tools,
                maxTokens: req.maxTokens,
                temperature: req.temperature,
                preferCheapFor,
                signal: req.signal,
            };
            const routerOpts = {};
            if (req.providerHint)
                routerOpts.order = [req.providerHint];
            let attempt = 0;
            let lastError;
            while (attempt < this.maxAttempts) {
                if (attempt > 0) {
                    yield sleep(attempt * this.backoffMs);
                }
                attempt++;
                if ((_c = req.signal) === null || _c === void 0 ? void 0 : _c.aborted) {
                    throw createAbortError('Request was aborted');
                }
                const callStart = Date.now();
                let timeoutHandle;
                try {
                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutHandle = setTimeout(() => reject(createAbortError(`Provider call timed out after ${this.defaultTimeoutMs}ms`)), this.defaultTimeoutMs);
                    });
                    let result;
                    try {
                        result = yield Promise.race([this.router.call(llmRequest, routerOpts), timeoutPromise]);
                    }
                    finally {
                        if (timeoutHandle !== undefined)
                            clearTimeout(timeoutHandle);
                    }
                    const latencyMs = Date.now() - callStart;
                    const toolCalls = normalizeToolCalls(result.toolCalls);
                    const finishReason = toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop';
                    let usage;
                    if (result.usage) {
                        const { promptTokens, completionTokens } = result.usage;
                        usage = {
                            promptTokens,
                            completionTokens,
                            totalTokens: (promptTokens !== null && promptTokens !== void 0 ? promptTokens : 0) + (completionTokens !== null && completionTokens !== void 0 ? completionTokens : 0),
                        };
                    }
                    else {
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
                }
                catch (err) {
                    if (timeoutHandle !== undefined)
                        clearTimeout(timeoutHandle);
                    const error = err instanceof Error ? err : new Error(String(err));
                    const kind = classifyError(error);
                    this.emitError(error);
                    if (kind === 'cancelled' || kind === 'permanent')
                        throw error;
                    // Transient — record and maybe retry.
                    lastError = error;
                    logger.warn(`[ProviderService] transient error on attempt ${attempt}/${this.maxAttempts}`, {
                        error: error.message,
                    });
                    if (attempt >= this.maxAttempts)
                        throw error;
                }
            }
            throw lastError !== null && lastError !== void 0 ? lastError : new Error('No attempts made');
        });
    }
    listProviders() {
        if (!this.router.listProviders)
            return [];
        return this.router.listProviders().map(p => ({ name: p.id, available: p.healthy }));
    }
    /** Subscribe to all errors (transient, permanent, cancelled).  Returns an unsubscribe fn. */
    onError(cb) {
        this.errorListeners.add(cb);
        return () => { this.errorListeners.delete(cb); };
    }
    emitError(e) {
        this.errorListeners.forEach(cb => {
            try {
                cb(e);
            }
            catch ( /* swallow listener errors */_a) { /* swallow listener errors */ }
        });
    }
}
