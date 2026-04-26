// @vitest-environment node
/**
 * playwright-mcp-adapter.test.ts — Unit tests for PlaywrightMcpAdapter.
 *
 * Uses a FakeMcpClient that records all calls and returns canned responses.
 * Tests cover: success paths, failure paths, parse helpers, toolPrefix override,
 * AbortSignal propagation, optional ledger, and close() resilience.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  PlaywrightMcpAdapter,
  BrowserAdapterError,
  buildToolName,
  parseNavigate,
  parseScreenshot,
  type McpToolClientLike,
  type BrowserAdapterOptions,
} from './playwright-mcp-adapter';

// ====== FakeMcpClient ========================================================

interface CallRecord {
  name: string;
  args: Record<string, unknown>;
  opts?: { timeoutMs?: number; signal?: AbortSignal };
}

class FakeMcpClient implements McpToolClientLike {
  readonly calls: CallRecord[] = [];
  private _nextResult: unknown = {};
  private _nextError: Error | null = null;

  setResult(result: unknown): void {
    this._nextResult = result;
    this._nextError = null;
  }

  setError(err: Error): void {
    this._nextError = err;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<unknown> {
    this.calls.push({ name, args, opts });
    if (this._nextError) throw this._nextError;
    return this._nextResult;
  }
}

// ====== FakeLedger ===========================================================

interface LedgerEntry {
  kind: string;
  data: Record<string, unknown>;
}

class FakeLedger {
  readonly entries: LedgerEntry[] = [];
  append(e: LedgerEntry): void {
    this.entries.push(e);
  }
}

// ====== Helpers ==============================================================

function makeAdapter(
  overrides: Partial<BrowserAdapterOptions> = {},
  client?: FakeMcpClient,
): { adapter: PlaywrightMcpAdapter; client: FakeMcpClient; ledger: FakeLedger } {
  const fakeClient = client ?? new FakeMcpClient();
  const ledger = new FakeLedger();
  const adapter = new PlaywrightMcpAdapter({
    client: fakeClient,
    ledger,
    ...overrides,
  });
  return { adapter, client: fakeClient, ledger };
}

// ====== buildToolName ========================================================

describe('buildToolName', () => {
  it('concatenates prefix and action', () => {
    expect(buildToolName('browser_', 'navigate')).toBe('browser_navigate');
  });

  it('works with empty prefix', () => {
    expect(buildToolName('', 'click')).toBe('click');
  });

  it('works with custom prefix', () => {
    expect(buildToolName('pw_', 'screenshot')).toBe('pw_screenshot');
  });
});

// ====== parseNavigate ========================================================

describe('parseNavigate', () => {
  it('parses a valid response', () => {
    const result = parseNavigate({ url: 'https://example.com', status: 200, title: 'Example' });
    expect(result).toEqual({ url: 'https://example.com', status: 200, title: 'Example' });
  });

  it('defaults status to 200 if missing', () => {
    const result = parseNavigate({ url: 'https://x.com' });
    expect(result.status).toBe(200);
  });

  it('omits title if not a string', () => {
    const result = parseNavigate({ url: 'https://x.com', title: 42 });
    expect(result.title).toBeUndefined();
  });

  it('throws if url is missing', () => {
    expect(() => parseNavigate({ status: 200 })).toThrow(/url/);
  });

  it('throws if response is not an object', () => {
    expect(() => parseNavigate('bad')).toThrow(/not an object/);
  });

  it('throws if response is null', () => {
    expect(() => parseNavigate(null)).toThrow(/not an object/);
  });
});

// ====== parseScreenshot ======================================================

describe('parseScreenshot', () => {
  it('parses a valid png response', () => {
    const result = parseScreenshot({
      format: 'png',
      bytesBase64: 'abc123',
      width: 1280,
      height: 720,
    });
    expect(result).toEqual({ format: 'png', bytesBase64: 'abc123', width: 1280, height: 720 });
  });

  it('parses a valid jpeg response without dimensions', () => {
    const result = parseScreenshot({ format: 'jpeg', bytesBase64: 'xyz' });
    expect(result.format).toBe('jpeg');
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
  });

  it('throws if bytesBase64 is missing', () => {
    expect(() => parseScreenshot({ format: 'png' })).toThrow(/bytesBase64/);
  });

  it('throws if format is wrong', () => {
    expect(() => parseScreenshot({ format: 'gif', bytesBase64: 'abc' })).toThrow(/format/);
  });

  it('throws if format is missing', () => {
    expect(() => parseScreenshot({ bytesBase64: 'abc' })).toThrow(/format/);
  });

  it('throws if response is not an object', () => {
    expect(() => parseScreenshot(42)).toThrow(/not an object/);
  });

  it('throws if response is null', () => {
    expect(() => parseScreenshot(null)).toThrow(/not an object/);
  });
});

// ====== navigate =============================================================

describe('PlaywrightMcpAdapter.navigate', () => {
  it('calls browser_navigate with correct tool name and args', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://example.com', status: 200 });

    await adapter.navigate('https://example.com');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.name).toBe('browser_navigate');
    expect(client.calls[0]!.args).toMatchObject({ url: 'https://example.com' });
  });

  it('passes waitUntil when provided', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });

    await adapter.navigate('https://x.com', { waitUntil: 'networkidle' });

    expect(client.calls[0]!.args['waitUntil']).toBe('networkidle');
  });

  it('returns parsed NavigateResult', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://example.com', status: 301, title: 'Test' });

    const result = await adapter.navigate('https://example.com');

    expect(result).toEqual({ url: 'https://example.com', status: 301, title: 'Test' });
  });

  it('forwards custom timeoutMs to callTool', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });

    await adapter.navigate('https://x.com', { timeoutMs: 5000 });

    expect(client.calls[0]!.opts?.timeoutMs).toBe(5000);
  });

  it('wraps client errors in BrowserAdapterError with action=navigate', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('network timeout'));

    await expect(adapter.navigate('https://x.com')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrowserAdapterError &&
        e.action === 'navigate' &&
        (e.cause as Error).message === 'network timeout',
    );
  });

  it('emits ok:true ledger event on success', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });

    await adapter.navigate('https://x.com');

    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.kind).toBe('browser_action');
    expect(ledger.entries[0]!.data['action']).toBe('navigate');
    expect(ledger.entries[0]!.data['ok']).toBe(true);
    expect(typeof ledger.entries[0]!.data['durationMs']).toBe('number');
  });

  it('emits ok:false ledger event on failure', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setError(new Error('fail'));

    await expect(adapter.navigate('https://x.com')).rejects.toBeInstanceOf(BrowserAdapterError);

    expect(ledger.entries[0]!.data['ok']).toBe(false);
    expect(ledger.entries[0]!.data['action']).toBe('navigate');
  });
});

// ====== click ================================================================

describe('PlaywrightMcpAdapter.click', () => {
  it('calls browser_click with selector arg', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ clicked: true });

    await adapter.click('#btn');

    expect(client.calls[0]!.name).toBe('browser_click');
    expect(client.calls[0]!.args['selector']).toBe('#btn');
  });

  it('returns ClickResult with selector and clicked=true', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ clicked: true });

    const result = await adapter.click('#btn');

    expect(result).toEqual({ selector: '#btn', clicked: true });
  });

  it('defaults clicked to true if not in response', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({});

    const result = await adapter.click('.link');

    expect(result.clicked).toBe(true);
  });

  it('wraps errors in BrowserAdapterError with action=click', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('element not found'));

    await expect(adapter.click('#ghost')).rejects.toSatisfy(
      (e: unknown) => e instanceof BrowserAdapterError && e.action === 'click',
    );
  });

  it('emits ok:false ledger entry on failure', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setError(new Error('err'));

    await expect(adapter.click('#x')).rejects.toBeInstanceOf(BrowserAdapterError);

    expect(ledger.entries[0]!.data['ok']).toBe(false);
  });
});

// ====== type =================================================================

describe('PlaywrightMcpAdapter.type', () => {
  it('calls browser_type with selector and text args', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({});

    await adapter.type('#input', 'hello world');

    expect(client.calls[0]!.name).toBe('browser_type');
    expect(client.calls[0]!.args['selector']).toBe('#input');
    expect(client.calls[0]!.args['text']).toBe('hello world');
  });

  it('passes delayMs when provided', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({});

    await adapter.type('#input', 'hi', { delayMs: 50 });

    expect(client.calls[0]!.args['delayMs']).toBe(50);
  });

  it('returns TypeResult with selector and typed text', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({});

    const result = await adapter.type('#input', 'test');

    expect(result).toEqual({ selector: '#input', typed: 'test' });
  });

  it('wraps errors in BrowserAdapterError with action=type', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('cannot type'));

    await expect(adapter.type('#x', 'y')).rejects.toSatisfy(
      (e: unknown) => e instanceof BrowserAdapterError && e.action === 'type',
    );
  });
});

// ====== screenshot ===========================================================

describe('PlaywrightMcpAdapter.screenshot', () => {
  it('calls browser_screenshot with no extra args by default', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ format: 'png', bytesBase64: 'abc' });

    await adapter.screenshot();

    expect(client.calls[0]!.name).toBe('browser_screenshot');
    expect(client.calls[0]!.args).toEqual({});
  });

  it('passes fullPage, format, selector when provided', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ format: 'jpeg', bytesBase64: 'xyz' });

    await adapter.screenshot({ fullPage: true, format: 'jpeg', selector: '.hero' });

    expect(client.calls[0]!.args).toMatchObject({
      fullPage: true,
      format: 'jpeg',
      selector: '.hero',
    });
  });

  it('returns parsed ScreenshotResult', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ format: 'png', bytesBase64: 'data', width: 800, height: 600 });

    const result = await adapter.screenshot();

    expect(result).toEqual({ format: 'png', bytesBase64: 'data', width: 800, height: 600 });
  });

  it('wraps errors in BrowserAdapterError with action=screenshot', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('screenshot failed'));

    await expect(adapter.screenshot()).rejects.toSatisfy(
      (e: unknown) => e instanceof BrowserAdapterError && e.action === 'screenshot',
    );
  });

  it('wraps parse errors in BrowserAdapterError', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ format: 'bmp', bytesBase64: 'bad' }); // invalid format

    await expect(adapter.screenshot()).rejects.toBeInstanceOf(BrowserAdapterError);
  });

  it('emits ok:true ledger entry on success', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setResult({ format: 'png', bytesBase64: 'abc' });

    await adapter.screenshot();

    expect(ledger.entries[0]!.data['ok']).toBe(true);
    expect(ledger.entries[0]!.data['action']).toBe('screenshot');
  });
});

// ====== textContent ==========================================================

describe('PlaywrightMcpAdapter.textContent', () => {
  it('calls browser_textContent with selector arg', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ text: 'Hello World' });

    await adapter.textContent('h1');

    expect(client.calls[0]!.name).toBe('browser_textContent');
    expect(client.calls[0]!.args['selector']).toBe('h1');
  });

  it('returns TextResult with selector and text', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ text: 'Hello' });

    const result = await adapter.textContent('h1');

    expect(result).toEqual({ selector: 'h1', text: 'Hello' });
  });

  it('defaults text to empty string if missing in response', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({});

    const result = await adapter.textContent('p');

    expect(result.text).toBe('');
  });

  it('wraps errors in BrowserAdapterError with action=textContent', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('no element'));

    await expect(adapter.textContent('p')).rejects.toSatisfy(
      (e: unknown) => e instanceof BrowserAdapterError && e.action === 'textContent',
    );
  });
});

// ====== evaluate =============================================================

describe('PlaywrightMcpAdapter.evaluate', () => {
  it('calls browser_evaluate with expression arg', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ value: 42 });

    await adapter.evaluate('document.title');

    expect(client.calls[0]!.name).toBe('browser_evaluate');
    expect(client.calls[0]!.args['expression']).toBe('document.title');
  });

  it('returns EvalResult with typed value', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ value: 'My Page' });

    const result = await adapter.evaluate<string>('document.title');

    expect(result).toEqual({ value: 'My Page' });
  });

  it('falls back to full raw value if no value key', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult('raw-string');

    const result = await adapter.evaluate('1+1');

    expect(result.value).toBe('raw-string');
  });

  it('wraps errors in BrowserAdapterError with action=evaluate', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('eval error'));

    await expect(adapter.evaluate('bad')).rejects.toSatisfy(
      (e: unknown) => e instanceof BrowserAdapterError && e.action === 'evaluate',
    );
  });
});

// ====== close ================================================================

describe('PlaywrightMcpAdapter.close', () => {
  it('calls browser_close', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({});

    await adapter.close();

    expect(client.calls[0]!.name).toBe('browser_close');
  });

  it('calls browser_close even after a previous failure', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('nav error'));

    // First call fails
    await expect(adapter.navigate('https://x.com')).rejects.toBeInstanceOf(BrowserAdapterError);

    // Reset to success
    client.setResult({});

    // close() should still work
    await adapter.close();

    expect(client.calls[client.calls.length - 1]!.name).toBe('browser_close');
  });

  it('emits ok:true ledger entry on successful close', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setResult({});

    await adapter.close();

    expect(ledger.entries[0]!.data['action']).toBe('close');
    expect(ledger.entries[0]!.data['ok']).toBe(true);
  });

  it('wraps errors in BrowserAdapterError with action=close', async () => {
    const { adapter, client } = makeAdapter();
    client.setError(new Error('close failed'));

    await expect(adapter.close()).rejects.toSatisfy(
      (e: unknown) => e instanceof BrowserAdapterError && e.action === 'close',
    );
  });

  it('emits ok:false ledger entry on close failure', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setError(new Error('close err'));

    await expect(adapter.close()).rejects.toBeInstanceOf(BrowserAdapterError);

    expect(ledger.entries[0]!.data['ok']).toBe(false);
  });
});

// ====== toolPrefix override ==================================================

describe('toolPrefix override', () => {
  it('uses custom prefix for navigate', async () => {
    const client = new FakeMcpClient();
    client.setResult({ url: 'https://x.com', status: 200 });
    const adapter = new PlaywrightMcpAdapter({ client, toolPrefix: 'pw_' });

    await adapter.navigate('https://x.com');

    expect(client.calls[0]!.name).toBe('pw_navigate');
  });

  it('uses custom prefix for screenshot', async () => {
    const client = new FakeMcpClient();
    client.setResult({ format: 'png', bytesBase64: 'abc' });
    const adapter = new PlaywrightMcpAdapter({ client, toolPrefix: 'custom_' });

    await adapter.screenshot();

    expect(client.calls[0]!.name).toBe('custom_screenshot');
  });

  it('uses custom prefix for close', async () => {
    const client = new FakeMcpClient();
    client.setResult({});
    const adapter = new PlaywrightMcpAdapter({ client, toolPrefix: 'xyz_' });

    await adapter.close();

    expect(client.calls[0]!.name).toBe('xyz_close');
  });
});

// ====== AbortSignal propagation ==============================================

describe('AbortSignal propagation', () => {
  it('pre-aborted signal rejects navigate immediately with BrowserAdapterError', async () => {
    const { adapter } = makeAdapter();
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.navigate('https://x.com', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BrowserAdapterError);
  });

  it('pre-aborted signal emits ok:false ledger entry', async () => {
    const { adapter, ledger } = makeAdapter();
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.navigate('https://x.com', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BrowserAdapterError);

    expect(ledger.entries[0]!.data['ok']).toBe(false);
  });

  it('forwards live signal to callTool', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });
    const controller = new AbortController();

    await adapter.navigate('https://x.com', { signal: controller.signal });

    expect(client.calls[0]!.opts?.signal).toBe(controller.signal);
  });

  it('pre-aborted signal rejects click with BrowserAdapterError', async () => {
    const { adapter } = makeAdapter();
    const controller = new AbortController();
    controller.abort('user cancelled');

    await expect(
      adapter.click('#btn', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BrowserAdapterError);
  });
});

// ====== Ledger optional ======================================================

describe('Ledger optional', () => {
  it('does not throw when no ledger is configured (navigate success)', async () => {
    const client = new FakeMcpClient();
    client.setResult({ url: 'https://x.com', status: 200 });
    const adapter = new PlaywrightMcpAdapter({ client }); // no ledger

    await expect(adapter.navigate('https://x.com')).resolves.toBeDefined();
  });

  it('does not throw when no ledger is configured (navigate failure)', async () => {
    const client = new FakeMcpClient();
    client.setError(new Error('fail'));
    const adapter = new PlaywrightMcpAdapter({ client }); // no ledger

    await expect(adapter.navigate('https://x.com')).rejects.toBeInstanceOf(BrowserAdapterError);
  });

  it('does not throw when no ledger is configured (close)', async () => {
    const client = new FakeMcpClient();
    client.setResult({});
    const adapter = new PlaywrightMcpAdapter({ client }); // no ledger

    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

// ====== defaultTimeoutMs =====================================================

describe('defaultTimeoutMs', () => {
  it('uses default 15000 when not specified', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });

    await adapter.navigate('https://x.com');

    expect(client.calls[0]!.opts?.timeoutMs).toBe(15000);
  });

  it('uses custom defaultTimeoutMs from constructor', async () => {
    const client = new FakeMcpClient();
    client.setResult({ url: 'https://x.com', status: 200 });
    const adapter = new PlaywrightMcpAdapter({ client, defaultTimeoutMs: 3000 });

    await adapter.navigate('https://x.com');

    expect(client.calls[0]!.opts?.timeoutMs).toBe(3000);
  });

  it('per-call timeoutMs overrides default', async () => {
    const { adapter, client } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });

    await adapter.navigate('https://x.com', { timeoutMs: 999 });

    expect(client.calls[0]!.opts?.timeoutMs).toBe(999);
  });
});

// ====== Ledger entry structure ===============================================

describe('Ledger entry structure', () => {
  it('navigate ledger entry contains args with url', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setResult({ url: 'https://x.com', status: 200 });

    await adapter.navigate('https://x.com');

    expect((ledger.entries[0]!.data['args'] as Record<string, unknown>)['url']).toBe(
      'https://x.com',
    );
  });

  it('click ledger entry contains selector in args', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setResult({ clicked: true });

    await adapter.click('#my-btn');

    expect((ledger.entries[0]!.data['args'] as Record<string, unknown>)['selector']).toBe(
      '#my-btn',
    );
  });

  it('screenshot failure ledger entry has ok:false and action=screenshot', async () => {
    const { adapter, client, ledger } = makeAdapter();
    client.setError(new Error('boom'));

    await expect(adapter.screenshot()).rejects.toBeInstanceOf(BrowserAdapterError);

    expect(ledger.entries[0]!.data['ok']).toBe(false);
    expect(ledger.entries[0]!.data['action']).toBe('screenshot');
  });
});

// suppress unused import warning for vi
void vi;
