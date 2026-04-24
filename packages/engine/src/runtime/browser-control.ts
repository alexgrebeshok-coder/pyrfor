/**
 * browser-control.ts — Pyrfor BrowserController.
 *
 * High-level façade over Playwright (lazy-loaded at runtime; NOT a hard dep).
 * Provides navigate/click/type/screenshot/getText/evaluate with:
 *   - Pluggable BrowserLauncher for test injection (fake instead of real Chromium).
 *   - A single default page created lazily on first action.
 *   - Consistent BrowserActionResult<T> wrapping (ok, data, error, durationMs).
 *   - Event bus: 'launch' | 'close' | 'navigate' | 'action'.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type BrowserKind = 'chromium' | 'firefox' | 'webkit';

export interface BrowserLaunchOptions {
  kind?: BrowserKind;
  headless?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
  startupTimeoutMs?: number;
  navTimeoutMs?: number;
  actionTimeoutMs?: number;
}

export interface BrowserActionResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}

export interface BrowserPage {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string, opts?: { delayMs?: number }): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  getText(selector: string): Promise<string>;
  innerHTML(selector: string): Promise<string>;
  evaluate<T>(fn: string | ((arg?: any) => T), arg?: any): Promise<T>;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer | Uint8Array>;
  waitForSelector(selector: string, opts?: { timeoutMs?: number }): Promise<void>;
  url(): string;
  title(): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserHandle {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export type BrowserLauncher = (opts: BrowserLaunchOptions) => Promise<BrowserHandle>;

export interface BrowserController {
  launch(opts?: BrowserLaunchOptions): Promise<void>;
  close(): Promise<void>;
  newPage(): Promise<BrowserPage>;
  navigate(url: string): Promise<BrowserActionResult<{ url: string; title: string }>>;
  click(selector: string): Promise<BrowserActionResult>;
  type(selector: string, text: string, opts?: { delayMs?: number }): Promise<BrowserActionResult>;
  getText(selector: string): Promise<BrowserActionResult<string>>;
  screenshot(opts?: { fullPage?: boolean }): Promise<BrowserActionResult<Buffer | Uint8Array>>;
  evaluate<T = any>(fn: string | ((arg?: any) => T), arg?: any): Promise<BrowserActionResult<T>>;
  isLaunched(): boolean;
  on(event: 'launch' | 'close' | 'navigate' | 'action', cb: (payload: any) => void): () => void;
}

export interface CreateBrowserControllerOptions {
  launcher?: BrowserLauncher;
  defaultLaunchOpts?: BrowserLaunchOptions;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  clock?: () => number;
}

// ── Timeout helper ────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout: ${label} exceeded ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ── Playwright page adapter ───────────────────────────────────────────────────

function adaptPage(pw: any): BrowserPage {
  return {
    async goto(url: string) { await pw.goto(url); },
    async click(selector: string) { await pw.click(selector); },
    async type(selector: string, text: string, opts?: { delayMs?: number }) {
      await pw.type(selector, text, { delay: opts?.delayMs });
    },
    async fill(selector: string, text: string) { await pw.fill(selector, text); },
    async getText(selector: string) { return (await pw.textContent(selector)) ?? ''; },
    async innerHTML(selector: string) { return (await pw.innerHTML(selector)) ?? ''; },
    async evaluate<T>(fn: string | ((arg?: any) => T), arg?: any): Promise<T> {
      if (typeof fn === 'string') {
        // eslint-disable-next-line no-new-func
        return pw.evaluate(new Function(fn) as any, arg);
      }
      return pw.evaluate(fn, arg);
    },
    async screenshot(opts?: { fullPage?: boolean }) {
      return pw.screenshot({ fullPage: opts?.fullPage });
    },
    async waitForSelector(selector: string, opts?: { timeoutMs?: number }) {
      await pw.waitForSelector(selector, { timeout: opts?.timeoutMs });
    },
    url() { return pw.url(); },
    async title() { return pw.title(); },
    async close() { await pw.close(); },
  };
}

// ── Default (Playwright) launcher ─────────────────────────────────────────────

async function buildPlaywrightLauncher(opts: BrowserLaunchOptions): Promise<BrowserHandle> {
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('playwright not installed and no launcher provided');
  }

  const kind = opts.kind ?? 'chromium';
  const browserClass = pw[kind];
  if (!browserClass) {
    throw new Error(`[Browser] Unknown browser kind: ${kind}`);
  }

  const launchOpts: Record<string, any> = { headless: opts.headless ?? true };
  if (opts.userAgent || opts.viewport) {
    // These go into context options, not launch options — handled at newPage time.
  }

  const browser = await browserClass.launch(launchOpts);
  return {
    async newPage() {
      const ctxOpts: Record<string, any> = {};
      if (opts.userAgent) ctxOpts.userAgent = opts.userAgent;
      if (opts.viewport) ctxOpts.viewport = opts.viewport;
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      return adaptPage(page);
    },
    async close() { await browser.close(); },
  };
}

// ── BrowserControllerImpl ─────────────────────────────────────────────────────

class BrowserControllerImpl implements BrowserController {
  private _handle: BrowserHandle | null = null;
  private _defaultPage: BrowserPage | null = null;
  private _launched = false;

  private readonly _listeners = new Map<string, Set<(payload: any) => void>>();
  private readonly _launcher: BrowserLauncher | undefined;
  private readonly _defaultLaunchOpts: BrowserLaunchOptions;
  private readonly _log: NonNullable<CreateBrowserControllerOptions['logger']>;
  private readonly _clock: () => number;

  constructor(opts: CreateBrowserControllerOptions = {}) {
    this._launcher          = opts.launcher;
    this._defaultLaunchOpts = opts.defaultLaunchOpts ?? {};
    this._log               = opts.logger ?? (() => {});
    this._clock             = opts.clock  ?? (() => Date.now());
  }

  // ── Event bus ─────────────────────────────────────────────────────────────

  on(
    event: 'launch' | 'close' | 'navigate' | 'action',
    cb: (payload: any) => void,
  ): () => void {
    let set = this._listeners.get(event);
    if (!set) { set = new Set(); this._listeners.set(event, set); }
    set.add(cb);
    return () => { this._listeners.get(event)?.delete(cb); };
  }

  private _emit(event: string, payload: any): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(payload); } catch (e) {
        this._log('warn', `[Browser] Event subscriber threw on '${event}'`, { error: String(e) });
      }
    }
  }

  // ── launch ────────────────────────────────────────────────────────────────

  async launch(opts?: BrowserLaunchOptions): Promise<void> {
    if (this._launched) {
      throw new Error('[Browser] already launched');
    }

    const merged: BrowserLaunchOptions = { ...this._defaultLaunchOpts, ...opts };
    const startupMs = merged.startupTimeoutMs ?? 30_000;

    const launcherFn = this._launcher ?? buildPlaywrightLauncher;

    this._log('info', '[Browser] Launching browser…');

    try {
      this._handle = await withTimeout(
        launcherFn(merged),
        startupMs,
        'browser launch',
      );
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      this._log('error', '[Browser] Launch failed', { error: msg });
      throw e;
    }

    this._launched = true;
    this._log('info', '[Browser] Launched');
    this._emit('launch', { opts: merged });
  }

  // ── close ─────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (!this._launched || !this._handle) return;

    try {
      if (this._defaultPage) {
        try { await this._defaultPage.close(); } catch { /* best-effort */ }
        this._defaultPage = null;
      }
      await this._handle.close();
    } catch (e) {
      this._log('warn', '[Browser] Error during close', { error: String(e) });
    }

    this._handle  = null;
    this._launched = false;
    this._emit('close', {});
  }

  // ── newPage ───────────────────────────────────────────────────────────────

  async newPage(): Promise<BrowserPage> {
    if (!this._handle) throw new Error('[Browser] not launched');
    return this._handle.newPage();
  }

  // ── default page helper ───────────────────────────────────────────────────

  private async _getDefaultPage(): Promise<BrowserPage> {
    if (!this._defaultPage) {
      this._defaultPage = await this._handle!.newPage();
    }
    return this._defaultPage;
  }

  // ── Action wrapper ────────────────────────────────────────────────────────

  private async _action<T>(
    name: string,
    fn: (page: BrowserPage) => Promise<T>,
    opts?: BrowserLaunchOptions,
  ): Promise<BrowserActionResult<T>> {
    if (!this._launched) {
      return { ok: false, error: 'not launched', durationMs: 0 };
    }

    const merged = { ...this._defaultLaunchOpts, ...opts };
    const timeoutMs = merged.actionTimeoutMs ?? 30_000;
    const start = this._clock();

    try {
      const page = await this._getDefaultPage();
      const data = await withTimeout(fn(page), timeoutMs, name);
      const durationMs = this._clock() - start;
      this._emit('action', { name, ok: true, durationMs });
      return { ok: true, data, durationMs };
    } catch (e: any) {
      const durationMs = this._clock() - start;
      const msg: string = e?.message ?? String(e);
      const isTimeout = msg.toLowerCase().includes('timeout');
      const error = isTimeout ? 'timeout' : msg;
      this._emit('action', { name, ok: false, durationMs });
      return { ok: false, error, durationMs };
    }
  }

  // ── navigate ──────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<BrowserActionResult<{ url: string; title: string }>> {
    if (!this._launched) {
      return { ok: false, error: 'not launched', durationMs: 0 };
    }

    const timeoutMs = this._defaultLaunchOpts.actionTimeoutMs ?? 30_000;
    const start = this._clock();

    try {
      const page = await this._getDefaultPage();
      await withTimeout(page.goto(url), timeoutMs, 'navigate');
      const title = await page.title();
      const finalUrl = page.url();
      const durationMs = this._clock() - start;
      const data = { url: finalUrl, title };
      this._emit('navigate', { url: finalUrl, title });
      this._emit('action', { name: 'navigate', ok: true, durationMs });
      return { ok: true, data, durationMs };
    } catch (e: any) {
      const durationMs = this._clock() - start;
      const msg: string = e?.message ?? String(e);
      const isTimeout = msg.toLowerCase().includes('timeout');
      const error = isTimeout ? 'timeout' : msg;
      this._emit('action', { name: 'navigate', ok: false, durationMs });
      return { ok: false, error, durationMs };
    }
  }

  // ── click ─────────────────────────────────────────────────────────────────

  async click(selector: string): Promise<BrowserActionResult> {
    return this._action('click', (p) => p.click(selector));
  }

  // ── type ──────────────────────────────────────────────────────────────────

  async type(
    selector: string,
    text: string,
    opts?: { delayMs?: number },
  ): Promise<BrowserActionResult> {
    return this._action('type', (p) => p.type(selector, text, opts));
  }

  // ── getText ───────────────────────────────────────────────────────────────

  async getText(selector: string): Promise<BrowserActionResult<string>> {
    return this._action('getText', (p) => p.getText(selector));
  }

  // ── screenshot ────────────────────────────────────────────────────────────

  async screenshot(opts?: { fullPage?: boolean }): Promise<BrowserActionResult<Buffer | Uint8Array>> {
    return this._action('screenshot', (p) => p.screenshot(opts));
  }

  // ── evaluate ──────────────────────────────────────────────────────────────

  async evaluate<T = any>(
    fn: string | ((arg?: any) => T),
    arg?: any,
  ): Promise<BrowserActionResult<T>> {
    return this._action('evaluate', (p) => p.evaluate<T>(fn, arg));
  }

  // ── isLaunched ────────────────────────────────────────────────────────────

  isLaunched(): boolean {
    return this._launched;
  }
}

// ── Public factory ────────────────────────────────────────────────────────────

export function createBrowserController(opts?: CreateBrowserControllerOptions): BrowserController {
  return new BrowserControllerImpl(opts);
}
