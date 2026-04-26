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

// ====== McpToolClientLike — structural interface ==============================

export interface McpToolClientLike {
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<unknown>;
}

// ====== BrowserAdapterOptions ================================================

export interface BrowserAdapterOptions {
  client: McpToolClientLike;
  /** Prefix prepended to every tool name. Default: `'browser_'`. */
  toolPrefix?: string;
  /** Default timeout for every `callTool` invocation. Default: `15000`. */
  defaultTimeoutMs?: number;
  /** Optional ledger to emit `browser_action` audit events. */
  ledger?: {
    append(e: { kind: string; data: Record<string, unknown> }): Promise<void> | void;
  };
}

// ====== Result types =========================================================

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

// ====== BrowserAdapterError ==================================================

export class BrowserAdapterError extends Error {
  readonly action: string;
  readonly cause: unknown;

  constructor(action: string, cause: unknown) {
    const message =
      cause instanceof Error
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
export function buildToolName(prefix: string, action: string): string {
  return `${prefix}${action}`;
}

/**
 * Parse raw MCP response into a `NavigateResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseNavigate(raw: unknown): NavigateResult {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('parseNavigate: response is not an object');
  }
  const r = raw as Record<string, unknown>;
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
export function parseScreenshot(raw: unknown): ScreenshotResult {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('parseScreenshot: response is not an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r['bytesBase64'] !== 'string') {
    throw new Error('parseScreenshot: missing or invalid "bytesBase64" field');
  }
  if (r['format'] !== 'png' && r['format'] !== 'jpeg') {
    throw new Error(
      `parseScreenshot: invalid "format" field — expected "png" or "jpeg", got ${JSON.stringify(r['format'])}`,
    );
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
async function emitLedger(
  ledger: BrowserAdapterOptions['ledger'],
  action: string,
  args: Record<string, unknown>,
  ok: boolean,
  durationMs: number,
): Promise<void> {
  if (!ledger) return;
  try {
    await ledger.append({ kind: 'browser_action', data: { action, args, ok, durationMs } });
  } catch {
    // Ledger failures must never propagate to callers.
  }
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
  // ── Private state ──────────────────────────────────────────────────────────
  private readonly _client: McpToolClientLike;
  private readonly _prefix: string;
  private readonly _defaultTimeoutMs: number;
  private readonly _ledger: BrowserAdapterOptions['ledger'];

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(opts: BrowserAdapterOptions) {
    this._client = opts.client;
    this._prefix = opts.toolPrefix ?? 'browser_';
    this._defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000;
    this._ledger = opts.ledger;
  }

  // ── Internal call wrapper ──────────────────────────────────────────────────

  /**
   * Calls the MCP tool, wraps errors in BrowserAdapterError, and emits to ledger.
   */
  private async _call<T>(
    action: string,
    args: Record<string, unknown>,
    parse: (raw: unknown) => T,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    const toolName = buildToolName(this._prefix, action);
    const timeoutMs = opts?.timeoutMs ?? this._defaultTimeoutMs;
    const start = Date.now();

    // Check for pre-aborted signal before calling.
    if (opts?.signal?.aborted) {
      const abortErr = new Error(
        typeof opts.signal.reason === 'string'
          ? opts.signal.reason
          : 'The operation was aborted.',
      );
      abortErr.name = 'AbortError';
      const durationMs = Date.now() - start;
      await emitLedger(this._ledger, action, args, false, durationMs);
      throw new BrowserAdapterError(action, abortErr);
    }

    let raw: unknown;
    try {
      raw = await this._client.callTool(toolName, args, { timeoutMs, signal: opts?.signal });
    } catch (err) {
      const durationMs = Date.now() - start;
      await emitLedger(this._ledger, action, args, false, durationMs);
      throw new BrowserAdapterError(action, err);
    }

    let result: T;
    try {
      result = parse(raw);
    } catch (err) {
      const durationMs = Date.now() - start;
      await emitLedger(this._ledger, action, args, false, durationMs);
      throw new BrowserAdapterError(action, err);
    }

    const durationMs = Date.now() - start;
    await emitLedger(this._ledger, action, args, true, durationMs);
    return result;
  }

  // ── navigate ───────────────────────────────────────────────────────────────

  /**
   * Navigate the browser to the given URL.
   */
  async navigate(
    url: string,
    opts?: {
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<NavigateResult> {
    const args: Record<string, unknown> = { url };
    if (opts?.waitUntil !== undefined) args['waitUntil'] = opts.waitUntil;
    return this._call('navigate', args, parseNavigate, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
    });
  }

  // ── click ──────────────────────────────────────────────────────────────────

  /**
   * Click on the element matching the given CSS selector.
   */
  async click(
    selector: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ClickResult> {
    const args: Record<string, unknown> = { selector };
    return this._call(
      'click',
      args,
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          selector,
          clicked: typeof r?.['clicked'] === 'boolean' ? r['clicked'] : true,
        };
      },
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }

  // ── type ───────────────────────────────────────────────────────────────────

  /**
   * Type text into the element matching the given CSS selector.
   */
  async type(
    selector: string,
    text: string,
    opts?: { delayMs?: number; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<TypeResult> {
    const args: Record<string, unknown> = { selector, text };
    if (opts?.delayMs !== undefined) args['delayMs'] = opts.delayMs;
    return this._call(
      'type',
      args,
      () => ({ selector, typed: text }),
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }

  // ── screenshot ─────────────────────────────────────────────────────────────

  /**
   * Capture a screenshot of the current page or a specific element.
   */
  async screenshot(opts?: {
    fullPage?: boolean;
    format?: 'png' | 'jpeg';
    selector?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<ScreenshotResult> {
    const args: Record<string, unknown> = {};
    if (opts?.fullPage !== undefined) args['fullPage'] = opts.fullPage;
    if (opts?.format !== undefined) args['format'] = opts.format;
    if (opts?.selector !== undefined) args['selector'] = opts.selector;
    return this._call('screenshot', args, parseScreenshot, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
    });
  }

  // ── textContent ────────────────────────────────────────────────────────────

  /**
   * Extract the text content of an element matching the given CSS selector.
   */
  async textContent(
    selector: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<TextResult> {
    const args: Record<string, unknown> = { selector };
    return this._call(
      'textContent',
      args,
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          selector,
          text: typeof r?.['text'] === 'string' ? r['text'] : '',
        };
      },
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }

  // ── evaluate ───────────────────────────────────────────────────────────────

  /**
   * Evaluate a JavaScript expression in the browser context.
   */
  async evaluate<T = unknown>(
    expression: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<EvalResult<T>> {
    const args: Record<string, unknown> = { expression };
    return this._call(
      'evaluate',
      args,
      (raw) => {
        const r = raw as Record<string, unknown>;
        return { value: (r?.['value'] ?? raw) as T };
      },
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }

  // ── close ──────────────────────────────────────────────────────────────────

  /**
   * Close the browser context by invoking the `browser_close` MCP tool.
   * This uses a direct tool name (not `_prefix + 'close'`) per spec.
   */
  async close(): Promise<void> {
    const toolName = buildToolName(this._prefix, 'close');
    const start = Date.now();
    const args: Record<string, unknown> = {};
    try {
      await this._client.callTool(toolName, args, { timeoutMs: this._defaultTimeoutMs });
    } catch (err) {
      const durationMs = Date.now() - start;
      await emitLedger(this._ledger, 'close', args, false, durationMs);
      throw new BrowserAdapterError('close', err);
    }
    const durationMs = Date.now() - start;
    await emitLedger(this._ledger, 'close', args, true, durationMs);
  }
}
