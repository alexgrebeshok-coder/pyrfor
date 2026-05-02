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
export interface McpToolClientLike {
    callTool(name: string, args: Record<string, unknown>, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<unknown>;
}
export interface BrowserAdapterOptions {
    client: McpToolClientLike;
    /** Prefix prepended to every tool name. Default: `'browser_'`. */
    toolPrefix?: string;
    /** Default timeout for every `callTool` invocation. Default: `15000`. */
    defaultTimeoutMs?: number;
    /** Optional ledger to emit `browser_action` audit events. */
    ledger?: {
        append(e: {
            kind: string;
            data: Record<string, unknown>;
        }): Promise<void> | void;
    };
}
export interface NavigateResult {
    url: string;
    status: number;
    title?: string;
}
export interface ClickResult {
    selector: string;
    clicked: boolean;
}
export interface TypeResult {
    selector: string;
    typed: string;
}
export interface ScreenshotResult {
    format: 'png' | 'jpeg';
    bytesBase64: string;
    width?: number;
    height?: number;
}
export interface TextResult {
    selector: string;
    text: string;
}
export interface EvalResult<T = unknown> {
    value: T;
}
export declare class BrowserAdapterError extends Error {
    readonly action: string;
    readonly cause: unknown;
    constructor(action: string, cause: unknown);
}
/**
 * Build a full MCP tool name from a prefix and action.
 * e.g. buildToolName('browser_', 'navigate') → 'browser_navigate'
 */
export declare function buildToolName(prefix: string, action: string): string;
/**
 * Parse raw MCP response into a `NavigateResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export declare function parseNavigate(raw: unknown): NavigateResult;
/**
 * Parse raw MCP response into a `ScreenshotResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export declare function parseScreenshot(raw: unknown): ScreenshotResult;
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
export declare class PlaywrightMcpAdapter {
    private readonly _client;
    private readonly _prefix;
    private readonly _defaultTimeoutMs;
    private readonly _ledger;
    constructor(opts: BrowserAdapterOptions);
    /**
     * Calls the MCP tool, wraps errors in BrowserAdapterError, and emits to ledger.
     */
    private _call;
    /**
     * Navigate the browser to the given URL.
     */
    navigate(url: string, opts?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<NavigateResult>;
    /**
     * Click on the element matching the given CSS selector.
     */
    click(selector: string, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<ClickResult>;
    /**
     * Type text into the element matching the given CSS selector.
     */
    type(selector: string, text: string, opts?: {
        delayMs?: number;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<TypeResult>;
    /**
     * Capture a screenshot of the current page or a specific element.
     */
    screenshot(opts?: {
        fullPage?: boolean;
        format?: 'png' | 'jpeg';
        selector?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<ScreenshotResult>;
    /**
     * Extract the text content of an element matching the given CSS selector.
     */
    textContent(selector: string, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<TextResult>;
    /**
     * Evaluate a JavaScript expression in the browser context.
     */
    evaluate<T = unknown>(expression: string, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<EvalResult<T>>;
    /**
     * Close the browser context by invoking the `browser_close` MCP tool.
     * This uses a direct tool name (not `_prefix + 'close'`) per spec.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=playwright-mcp-adapter.d.ts.map