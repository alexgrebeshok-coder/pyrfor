/**
 * playwright-mcp-adapter.ts — Playwright-MCP browser adapter for Pyrfor Engine.
 *
 * A typed facade over an MCP tool layer that maps high-level browser actions
 * (navigate, click, type, screenshot, textContent, evaluate, close) to
 * underlying MCP tool calls via a structural `McpToolClientLike` interface.
 *
 * Design notes:
 *  - Does NOT spawn Playwright itself; caller provides `McpToolClientLike`.
 *  - All public methods forward an optional AbortSignal to `callTool`.
 *  - On failure, the original error is wrapped in `BrowserAdapterError` with
 *    `action` and `cause` fields for structured error handling.
 *  - If a ledger is provided, a `browser_action` event is emitted after every
 *    call (success or failure) with `ok`, `action`, `args`, and `durationMs`.
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
// ====== BrowserAdapterError ==================================================
export class BrowserAdapterError extends Error {
    constructor(action, cause) {
        const message = cause instanceof Error
            ? `BrowserAdapter [${action}]: ${cause.message}`
            : `BrowserAdapter [${action}]: ${String(cause)}`;
        super(message);
        this.name = 'BrowserAdapterError';
        this.action = action;
        this.cause = cause;
    }
}
// ====== Pure helpers =========================================================
/**
 * Build a full MCP tool name from a prefix and action.
 * e.g. buildToolName('browser_', 'navigate') → 'browser_navigate'
 */
export function buildToolName(prefix, action) {
    return `${prefix}${action}`;
}
/**
 * Parse raw MCP response into a `NavigateResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseNavigate(raw) {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('parseNavigate: response is not an object');
    }
    const r = raw;
    if (typeof r['url'] !== 'string') {
        throw new Error('parseNavigate: missing or invalid "url" field');
    }
    const status = typeof r['status'] === 'number' ? r['status'] : 200;
    const title = typeof r['title'] === 'string' ? r['title'] : undefined;
    return { url: r['url'], status, title };
}
/**
 * Parse raw MCP response into a `ScreenshotResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseScreenshot(raw) {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('parseScreenshot: response is not an object');
    }
    const r = raw;
    if (typeof r['bytesBase64'] !== 'string') {
        throw new Error('parseScreenshot: missing or invalid "bytesBase64" field');
    }
    if (r['format'] !== 'png' && r['format'] !== 'jpeg') {
        throw new Error(`parseScreenshot: invalid "format" field — expected "png" or "jpeg", got ${JSON.stringify(r['format'])}`);
    }
    const width = typeof r['width'] === 'number' ? r['width'] : undefined;
    const height = typeof r['height'] === 'number' ? r['height'] : undefined;
    return {
        format: r['format'],
        bytesBase64: r['bytesBase64'],
        width,
        height,
    };
}
// ====== Internal helpers =====================================================
/** Emit a ledger event if a ledger is configured; never throws. */
function emitLedger(ledger, action, args, ok, durationMs) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ledger)
            return;
        try {
            yield ledger.append({ kind: 'browser_action', data: { action, args, ok, durationMs } });
        }
        catch (_a) {
            // Ledger failures must never propagate to callers.
        }
    });
}
// ====== PlaywrightMcpAdapter =================================================
/**
 * High-level browser adapter that maps typed browser actions to MCP tool calls.
 *
 * Usage:
 * ```ts
 * const adapter = new PlaywrightMcpAdapter({ client: myMcpClient });
 * const nav = await adapter.navigate('https://example.com');
 * const shot = await adapter.screenshot({ fullPage: true });
 * await adapter.close();
 * ```
 */
export class PlaywrightMcpAdapter {
    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(opts) {
        var _a, _b;
        this._client = opts.client;
        this._prefix = (_a = opts.toolPrefix) !== null && _a !== void 0 ? _a : 'browser_';
        this._defaultTimeoutMs = (_b = opts.defaultTimeoutMs) !== null && _b !== void 0 ? _b : 15000;
        this._ledger = opts.ledger;
    }
    // ── Internal call wrapper ──────────────────────────────────────────────────
    /**
     * Calls the MCP tool, wraps errors in BrowserAdapterError, and emits to ledger.
     */
    _call(action, args, parse, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const toolName = buildToolName(this._prefix, action);
            const timeoutMs = (_a = opts === null || opts === void 0 ? void 0 : opts.timeoutMs) !== null && _a !== void 0 ? _a : this._defaultTimeoutMs;
            const start = Date.now();
            // Check for pre-aborted signal before calling.
            if ((_b = opts === null || opts === void 0 ? void 0 : opts.signal) === null || _b === void 0 ? void 0 : _b.aborted) {
                const abortErr = new Error(typeof opts.signal.reason === 'string'
                    ? opts.signal.reason
                    : 'The operation was aborted.');
                abortErr.name = 'AbortError';
                const durationMs = Date.now() - start;
                yield emitLedger(this._ledger, action, args, false, durationMs);
                throw new BrowserAdapterError(action, abortErr);
            }
            let raw;
            try {
                raw = yield this._client.callTool(toolName, args, { timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
            }
            catch (err) {
                const durationMs = Date.now() - start;
                yield emitLedger(this._ledger, action, args, false, durationMs);
                throw new BrowserAdapterError(action, err);
            }
            let result;
            try {
                result = parse(raw);
            }
            catch (err) {
                const durationMs = Date.now() - start;
                yield emitLedger(this._ledger, action, args, false, durationMs);
                throw new BrowserAdapterError(action, err);
            }
            const durationMs = Date.now() - start;
            yield emitLedger(this._ledger, action, args, true, durationMs);
            return result;
        });
    }
    // ── navigate ───────────────────────────────────────────────────────────────
    /**
     * Navigate the browser to the given URL.
     */
    navigate(url, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = { url };
            if ((opts === null || opts === void 0 ? void 0 : opts.waitUntil) !== undefined)
                args['waitUntil'] = opts.waitUntil;
            return this._call('navigate', args, parseNavigate, {
                timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs,
                signal: opts === null || opts === void 0 ? void 0 : opts.signal,
            });
        });
    }
    // ── click ──────────────────────────────────────────────────────────────────
    /**
     * Click on the element matching the given CSS selector.
     */
    click(selector, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = { selector };
            return this._call('click', args, (raw) => {
                const r = raw;
                return {
                    selector,
                    clicked: typeof (r === null || r === void 0 ? void 0 : r['clicked']) === 'boolean' ? r['clicked'] : true,
                };
            }, { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
    // ── type ───────────────────────────────────────────────────────────────────
    /**
     * Type text into the element matching the given CSS selector.
     */
    type(selector, text, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = { selector, text };
            if ((opts === null || opts === void 0 ? void 0 : opts.delayMs) !== undefined)
                args['delayMs'] = opts.delayMs;
            return this._call('type', args, () => ({ selector, typed: text }), { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
    // ── screenshot ─────────────────────────────────────────────────────────────
    /**
     * Capture a screenshot of the current page or a specific element.
     */
    screenshot(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = {};
            if ((opts === null || opts === void 0 ? void 0 : opts.fullPage) !== undefined)
                args['fullPage'] = opts.fullPage;
            if ((opts === null || opts === void 0 ? void 0 : opts.format) !== undefined)
                args['format'] = opts.format;
            if ((opts === null || opts === void 0 ? void 0 : opts.selector) !== undefined)
                args['selector'] = opts.selector;
            return this._call('screenshot', args, parseScreenshot, {
                timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs,
                signal: opts === null || opts === void 0 ? void 0 : opts.signal,
            });
        });
    }
    // ── textContent ────────────────────────────────────────────────────────────
    /**
     * Extract the text content of an element matching the given CSS selector.
     */
    textContent(selector, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = { selector };
            return this._call('textContent', args, (raw) => {
                const r = raw;
                return {
                    selector,
                    text: typeof (r === null || r === void 0 ? void 0 : r['text']) === 'string' ? r['text'] : '',
                };
            }, { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
    // ── evaluate ───────────────────────────────────────────────────────────────
    /**
     * Evaluate a JavaScript expression in the browser context.
     */
    evaluate(expression, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = { expression };
            return this._call('evaluate', args, (raw) => {
                var _a;
                const r = raw;
                return { value: ((_a = r === null || r === void 0 ? void 0 : r['value']) !== null && _a !== void 0 ? _a : raw) };
            }, { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
    // ── close ──────────────────────────────────────────────────────────────────
    /**
     * Close the browser context by invoking the `browser_close` MCP tool.
     * This uses a direct tool name (not `_prefix + 'close'`) per spec.
     */
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            const toolName = buildToolName(this._prefix, 'close');
            const start = Date.now();
            const args = {};
            try {
                yield this._client.callTool(toolName, args, { timeoutMs: this._defaultTimeoutMs });
            }
            catch (err) {
                const durationMs = Date.now() - start;
                yield emitLedger(this._ledger, 'close', args, false, durationMs);
                throw new BrowserAdapterError('close', err);
            }
            const durationMs = Date.now() - start;
            yield emitLedger(this._ledger, 'close', args, true, durationMs);
        });
    }
}
