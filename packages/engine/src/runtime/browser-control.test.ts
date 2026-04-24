// @vitest-environment node
/**
 * Tests for packages/engine/src/runtime/browser-control.ts
 *
 * All tests inject a fake launcher so no real Chromium is spawned.
 * playwright is mocked to throw so the "no launcher + no playwright" test works
 * even in environments where the package is installed but browsers are absent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock playwright at the module level so lazy import throws 'playwright not installed'.
// All tests that actually exercise browser actions provide their own fake launcher and
// never reach the playwright import path, so this mock has no side-effect on them.
vi.mock('playwright', () => {
  throw new Error('Cannot find module playwright');
});
import {
  createBrowserController,
} from './browser-control.js';
import type {
  BrowserController,
  BrowserLauncher,
  BrowserLaunchOptions,
} from './browser-control.js';

// ── Fake browser factory ──────────────────────────────────────────────────────

function makeFakeBrowser(opts: {
  failNav?: string;
  pageText?: Record<string, string>;
  clickThrows?: boolean;
  navDelayMs?: number;
} = {}) {
  let pageUrl = 'about:blank';
  return {
    newPage: async () => ({
      async goto(url: string) {
        if (opts.failNav) throw new Error(opts.failNav);
        if (opts.navDelayMs) await new Promise<void>((r) => setTimeout(r, opts.navDelayMs));
        pageUrl = url;
      },
      async click(_s: string) { if (opts.clickThrows) throw new Error('click failed'); },
      async type(_s: string, _t: string, _o?: { delayMs?: number }) {},
      async fill(_s: string, _t: string) {},
      async getText(s: string) { return opts.pageText?.[s] ?? ''; },
      async innerHTML() { return '<html></html>'; },
      async evaluate(fn: any, arg?: any) { return typeof fn === 'function' ? fn(arg) : 42; },
      async screenshot() { return Buffer.from('PNG'); },
      async waitForSelector() {},
      url() { return pageUrl; },
      async title() { return 'Test Title'; },
      async close() {},
    }),
    async close() {},
  };
}

const launcher: BrowserLauncher = async () => makeFakeBrowser();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtrl(
  launcherOpts?: Parameters<typeof makeFakeBrowser>[0],
  controllerOpts?: Omit<Parameters<typeof createBrowserController>[0], 'launcher'>,
  launchOpts?: BrowserLaunchOptions,
): BrowserController {
  return createBrowserController({
    launcher: async () => makeFakeBrowser(launcherOpts),
    ...controllerOpts,
    defaultLaunchOpts: launchOpts,
  });
}

const controllers: BrowserController[] = [];

function tracked(ctrl: BrowserController): BrowserController {
  controllers.push(ctrl);
  return ctrl;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('BrowserController', () => {
  afterEach(async () => {
    for (const c of controllers) await c.close().catch(() => {});
    controllers.length = 0;
  });

  // ── 1. launch / isLaunched ────────────────────────────────────────────────

  it('launch with fake launcher → isLaunched=true', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    expect(ctrl.isLaunched()).toBe(false);
    await ctrl.launch();
    expect(ctrl.isLaunched()).toBe(true);
  });

  it('launch emits "launch" event', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const events: any[] = [];
    ctrl.on('launch', (p) => events.push(p));
    await ctrl.launch();
    expect(events).toHaveLength(1);
  });

  it('second launch throws "already launched"', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    await expect(ctrl.launch()).rejects.toThrow('already launched');
  });

  // ── 2. close ─────────────────────────────────────────────────────────────

  it('close after launch → isLaunched=false + emits "close"', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const events: any[] = [];
    ctrl.on('close', (p) => events.push(p));
    await ctrl.launch();
    await ctrl.close();
    expect(ctrl.isLaunched()).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('close before launch is a no-op (does not throw)', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await expect(ctrl.close()).resolves.toBeUndefined();
    expect(ctrl.isLaunched()).toBe(false);
  });

  it('close is idempotent', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    await ctrl.close();
    await expect(ctrl.close()).resolves.toBeUndefined();
    expect(ctrl.isLaunched()).toBe(false);
  });

  // ── 3. navigate ───────────────────────────────────────────────────────────

  it('navigate when not launched → ok=false, error contains "not launched"', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const result = await ctrl.navigate('http://example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not launched/);
  });

  it('navigate success → ok=true with url/title, emits "navigate"', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const navEvents: any[] = [];
    ctrl.on('navigate', (p) => navEvents.push(p));
    await ctrl.launch();
    const result = await ctrl.navigate('http://example.com');
    expect(result.ok).toBe(true);
    expect(result.data?.url).toBe('http://example.com');
    expect(result.data?.title).toBe('Test Title');
    expect(navEvents).toHaveLength(1);
    expect(navEvents[0].url).toBe('http://example.com');
  });

  it('navigate failNav → ok=false with error message', async () => {
    const ctrl = tracked(makeCtrl({ failNav: 'navigation rejected' }));
    await ctrl.launch();
    const result = await ctrl.navigate('http://fail.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('navigation rejected');
  });

  it('navigate timeout (navDelayMs > actionTimeoutMs) → ok=false "timeout"', async () => {
    const ctrl = tracked(
      createBrowserController({
        launcher: async () => makeFakeBrowser({ navDelayMs: 200 }),
        defaultLaunchOpts: { actionTimeoutMs: 50 },
      }),
    );
    await ctrl.launch();
    const result = await ctrl.navigate('http://slow.com');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── 4. click ─────────────────────────────────────────────────────────────

  it('click success → ok=true, emits "action"', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const actionEvents: any[] = [];
    ctrl.on('action', (p) => actionEvents.push(p));
    await ctrl.launch();
    const result = await ctrl.click('#btn');
    expect(result.ok).toBe(true);
    expect(actionEvents.some((e) => e.name === 'click' && e.ok)).toBe(true);
  });

  it('click error → ok=false with error', async () => {
    const ctrl = tracked(makeCtrl({ clickThrows: true }));
    await ctrl.launch();
    const result = await ctrl.click('#btn');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('click failed');
  });

  // ── 5. type ───────────────────────────────────────────────────────────────

  it('type passes selector + text + delay', async () => {
    const typeCalls: Array<{ s: string; t: string; d?: number }> = [];
    const fakeLauncher: BrowserLauncher = async () => ({
      newPage: async () => ({
        async goto() {},
        async click() {},
        async type(s: string, t: string, o?: { delayMs?: number }) {
          typeCalls.push({ s, t, d: o?.delayMs });
        },
        async fill() {},
        async getText() { return ''; },
        async innerHTML() { return ''; },
        async evaluate() { return undefined as any; },
        async screenshot() { return Buffer.from(''); },
        async waitForSelector() {},
        url() { return ''; },
        async title() { return ''; },
        async close() {},
      }),
      async close() {},
    });
    const ctrl = tracked(createBrowserController({ launcher: fakeLauncher }));
    await ctrl.launch();
    const result = await ctrl.type('#input', 'hello', { delayMs: 50 });
    expect(result.ok).toBe(true);
    expect(typeCalls[0]).toEqual({ s: '#input', t: 'hello', d: 50 });
  });

  // ── 6. getText ────────────────────────────────────────────────────────────

  it('getText returns pageText for selector', async () => {
    const ctrl = tracked(makeCtrl({ pageText: { '#title': 'Hello World' } }));
    await ctrl.launch();
    const result = await ctrl.getText('#title');
    expect(result.ok).toBe(true);
    expect(result.data).toBe('Hello World');
  });

  it('getText missing selector → empty string, ok=true', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    const result = await ctrl.getText('#nonexistent');
    expect(result.ok).toBe(true);
    expect(result.data).toBe('');
  });

  // ── 7. screenshot ─────────────────────────────────────────────────────────

  it('screenshot returns Buffer', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    const result = await ctrl.screenshot();
    expect(result.ok).toBe(true);
    expect(Buffer.isBuffer(result.data) || result.data instanceof Uint8Array).toBe(true);
    expect(Buffer.from(result.data as Buffer).toString()).toBe('PNG');
  });

  // ── 8. evaluate ───────────────────────────────────────────────────────────

  it('evaluate with arrow fn returns computed value', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    const result = await ctrl.evaluate((arg?: any) => (arg as number) * 2, 21);
    expect(result.ok).toBe(true);
    expect(result.data).toBe(42);
  });

  it('evaluate with string source returns 42 (fake stub)', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    const result = await ctrl.evaluate('return document.title');
    expect(result.ok).toBe(true);
    expect(result.data).toBe(42);
  });

  // ── 9. newPage ────────────────────────────────────────────────────────────

  it('newPage returns a BrowserPage', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    const page = await ctrl.newPage();
    expect(typeof page.goto).toBe('function');
    expect(typeof page.click).toBe('function');
    expect(typeof page.url).toBe('function');
  });

  // ── 10. Event bus ─────────────────────────────────────────────────────────

  it('on("launch") receives payload', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const payloads: any[] = [];
    ctrl.on('launch', (p) => payloads.push(p));
    await ctrl.launch();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toBeDefined();
  });

  it('on("close") receives payload', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const payloads: any[] = [];
    ctrl.on('close', (p) => payloads.push(p));
    await ctrl.launch();
    await ctrl.close();
    expect(payloads).toHaveLength(1);
  });

  it('on("navigate") receives url + title', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const payloads: any[] = [];
    ctrl.on('navigate', (p) => payloads.push(p));
    await ctrl.launch();
    await ctrl.navigate('https://test.com');
    expect(payloads[0].url).toBe('https://test.com');
    expect(payloads[0].title).toBe('Test Title');
  });

  it('on("action") receives name + ok + durationMs', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const payloads: any[] = [];
    ctrl.on('action', (p) => payloads.push(p));
    await ctrl.launch();
    await ctrl.click('#btn');
    const clickAction = payloads.find((p) => p.name === 'click');
    expect(clickAction).toBeDefined();
    expect(clickAction.ok).toBe(true);
    expect(typeof clickAction.durationMs).toBe('number');
  });

  // ── 11. on/off unsub ──────────────────────────────────────────────────────

  it('on/off unsub stops further callbacks', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    const events: any[] = [];
    const unsub = ctrl.on('action', (p) => events.push(p));
    await ctrl.launch();
    await ctrl.click('#a');
    expect(events).toHaveLength(1);
    unsub();
    await ctrl.click('#b');
    expect(events).toHaveLength(1); // no new events after unsub
  });

  // ── 12. subscriber throw swallowed ────────────────────────────────────────

  it('subscriber throw is swallowed — action still resolves', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    ctrl.on('action', () => { throw new Error('subscriber blew up'); });
    await ctrl.launch();
    const result = await ctrl.click('#x');
    expect(result.ok).toBe(true);
  });

  // ── 13. launch timeout ────────────────────────────────────────────────────

  it('launch timeout when launcher hangs longer than startupTimeoutMs', async () => {
    const hangingLauncher: BrowserLauncher = () =>
      new Promise<any>((_resolve) => { /* never resolves */ });
    const ctrl = tracked(
      createBrowserController({
        launcher: hangingLauncher,
        defaultLaunchOpts: { startupTimeoutMs: 50 },
      }),
    );
    await expect(ctrl.launch()).rejects.toThrow(/timeout/i);
    expect(ctrl.isLaunched()).toBe(false);
  });

  // ── 14. no launcher + no playwright ──────────────────────────────────────

  it('launch with no launcher and no playwright throws descriptive error', async () => {
    // playwright is not installed in this project — the real lazy import will fail.
    const ctrl = createBrowserController({ /* no launcher */ });
    await expect(ctrl.launch()).rejects.toThrow(/playwright not installed/i);
  });

  // ── 15. durationMs populated ─────────────────────────────────────────────

  it('durationMs is a non-negative number on success', async () => {
    const ctrl = tracked(createBrowserController({ launcher }));
    await ctrl.launch();
    const result = await ctrl.navigate('http://example.com');
    expect(result.ok).toBe(true);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('durationMs is populated on timeout', async () => {
    const ctrl = tracked(
      createBrowserController({
        launcher: async () => makeFakeBrowser({ navDelayMs: 200 }),
        defaultLaunchOpts: { actionTimeoutMs: 50 },
      }),
    );
    await ctrl.launch();
    const result = await ctrl.navigate('http://slow.com');
    expect(result.ok).toBe(false);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── 16. clock injection ───────────────────────────────────────────────────

  it('clock injection used for durationMs', async () => {
    let tick = 0;
    const clock = () => { tick += 100; return tick; };
    const ctrl = tracked(createBrowserController({ launcher, clock }));
    await ctrl.launch();
    const result = await ctrl.navigate('http://example.com');
    expect(result.ok).toBe(true);
    // clock goes 100 → 200 between start/end, so durationMs = 100
    expect(result.durationMs).toBe(100);
  });
});
