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
export type BrowserKind = 'chromium' | 'firefox' | 'webkit';
export interface BrowserLaunchOptions {
    kind?: BrowserKind;
    headless?: boolean;
    userAgent?: string;
    viewport?: {
        width: number;
        height: number;
    };
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
    type(selector: string, text: string, opts?: {
        delayMs?: number;
    }): Promise<void>;
    fill(selector: string, text: string): Promise<void>;
    getText(selector: string): Promise<string>;
    innerHTML(selector: string): Promise<string>;
    evaluate<T>(fn: string | ((arg?: any) => T), arg?: any): Promise<T>;
    screenshot(opts?: {
        fullPage?: boolean;
    }): Promise<Buffer | Uint8Array>;
    waitForSelector(selector: string, opts?: {
        timeoutMs?: number;
    }): Promise<void>;
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
    navigate(url: string): Promise<BrowserActionResult<{
        url: string;
        title: string;
    }>>;
    click(selector: string): Promise<BrowserActionResult>;
    type(selector: string, text: string, opts?: {
        delayMs?: number;
    }): Promise<BrowserActionResult>;
    getText(selector: string): Promise<BrowserActionResult<string>>;
    screenshot(opts?: {
        fullPage?: boolean;
    }): Promise<BrowserActionResult<Buffer | Uint8Array>>;
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
export declare function createBrowserController(opts?: CreateBrowserControllerOptions): BrowserController;
//# sourceMappingURL=browser-control.d.ts.map