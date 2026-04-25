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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ── Timeout helper ────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${label} exceeded ${ms}ms`)), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
// ── Playwright page adapter ───────────────────────────────────────────────────
function adaptPage(pw) {
    return {
        goto(url) {
            return __awaiter(this, void 0, void 0, function* () { yield pw.goto(url); });
        },
        click(selector) {
            return __awaiter(this, void 0, void 0, function* () { yield pw.click(selector); });
        },
        type(selector, text, opts) {
            return __awaiter(this, void 0, void 0, function* () {
                yield pw.type(selector, text, { delay: opts === null || opts === void 0 ? void 0 : opts.delayMs });
            });
        },
        fill(selector, text) {
            return __awaiter(this, void 0, void 0, function* () { yield pw.fill(selector, text); });
        },
        getText(selector) {
            return __awaiter(this, void 0, void 0, function* () { var _a; return (_a = (yield pw.textContent(selector))) !== null && _a !== void 0 ? _a : ''; });
        },
        innerHTML(selector) {
            return __awaiter(this, void 0, void 0, function* () { var _a; return (_a = (yield pw.innerHTML(selector))) !== null && _a !== void 0 ? _a : ''; });
        },
        evaluate(fn, arg) {
            return __awaiter(this, void 0, void 0, function* () {
                if (typeof fn === 'string') {
                    // eslint-disable-next-line no-new-func
                    return pw.evaluate(new Function(fn), arg);
                }
                return pw.evaluate(fn, arg);
            });
        },
        screenshot(opts) {
            return __awaiter(this, void 0, void 0, function* () {
                return pw.screenshot({ fullPage: opts === null || opts === void 0 ? void 0 : opts.fullPage });
            });
        },
        waitForSelector(selector, opts) {
            return __awaiter(this, void 0, void 0, function* () {
                yield pw.waitForSelector(selector, { timeout: opts === null || opts === void 0 ? void 0 : opts.timeoutMs });
            });
        },
        url() { return pw.url(); },
        title() {
            return __awaiter(this, void 0, void 0, function* () { return pw.title(); });
        },
        close() {
            return __awaiter(this, void 0, void 0, function* () { yield pw.close(); });
        },
    };
}
// ── Default (Playwright) launcher ─────────────────────────────────────────────
function buildPlaywrightLauncher(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        let pw;
        try {
            pw = yield import('playwright');
        }
        catch (_c) {
            throw new Error('playwright not installed and no launcher provided');
        }
        const kind = (_a = opts.kind) !== null && _a !== void 0 ? _a : 'chromium';
        const browserClass = pw[kind];
        if (!browserClass) {
            throw new Error(`[Browser] Unknown browser kind: ${kind}`);
        }
        const launchOpts = { headless: (_b = opts.headless) !== null && _b !== void 0 ? _b : true };
        if (opts.userAgent || opts.viewport) {
            // These go into context options, not launch options — handled at newPage time.
        }
        const browser = yield browserClass.launch(launchOpts);
        return {
            newPage() {
                return __awaiter(this, void 0, void 0, function* () {
                    const ctxOpts = {};
                    if (opts.userAgent)
                        ctxOpts.userAgent = opts.userAgent;
                    if (opts.viewport)
                        ctxOpts.viewport = opts.viewport;
                    const ctx = yield browser.newContext(ctxOpts);
                    const page = yield ctx.newPage();
                    return adaptPage(page);
                });
            },
            close() {
                return __awaiter(this, void 0, void 0, function* () { yield browser.close(); });
            },
        };
    });
}
// ── BrowserControllerImpl ─────────────────────────────────────────────────────
class BrowserControllerImpl {
    constructor(opts = {}) {
        var _a, _b, _c;
        this._handle = null;
        this._defaultPage = null;
        this._launched = false;
        this._listeners = new Map();
        this._launcher = opts.launcher;
        this._defaultLaunchOpts = (_a = opts.defaultLaunchOpts) !== null && _a !== void 0 ? _a : {};
        this._log = (_b = opts.logger) !== null && _b !== void 0 ? _b : (() => { });
        this._clock = (_c = opts.clock) !== null && _c !== void 0 ? _c : (() => Date.now());
    }
    // ── Event bus ─────────────────────────────────────────────────────────────
    on(event, cb) {
        let set = this._listeners.get(event);
        if (!set) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(cb);
        return () => { var _a; (_a = this._listeners.get(event)) === null || _a === void 0 ? void 0 : _a.delete(cb); };
    }
    _emit(event, payload) {
        const set = this._listeners.get(event);
        if (!set)
            return;
        for (const cb of set) {
            try {
                cb(payload);
            }
            catch (e) {
                this._log('warn', `[Browser] Event subscriber threw on '${event}'`, { error: String(e) });
            }
        }
    }
    // ── launch ────────────────────────────────────────────────────────────────
    launch(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (this._launched) {
                throw new Error('[Browser] already launched');
            }
            const merged = Object.assign(Object.assign({}, this._defaultLaunchOpts), opts);
            const startupMs = (_a = merged.startupTimeoutMs) !== null && _a !== void 0 ? _a : 30000;
            const launcherFn = (_b = this._launcher) !== null && _b !== void 0 ? _b : buildPlaywrightLauncher;
            this._log('info', '[Browser] Launching browser…');
            try {
                this._handle = yield withTimeout(launcherFn(merged), startupMs, 'browser launch');
            }
            catch (e) {
                const msg = (_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : String(e);
                this._log('error', '[Browser] Launch failed', { error: msg });
                throw e;
            }
            this._launched = true;
            this._log('info', '[Browser] Launched');
            this._emit('launch', { opts: merged });
        });
    }
    // ── close ─────────────────────────────────────────────────────────────────
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._launched || !this._handle)
                return;
            try {
                if (this._defaultPage) {
                    try {
                        yield this._defaultPage.close();
                    }
                    catch ( /* best-effort */_a) { /* best-effort */ }
                    this._defaultPage = null;
                }
                yield this._handle.close();
            }
            catch (e) {
                this._log('warn', '[Browser] Error during close', { error: String(e) });
            }
            this._handle = null;
            this._launched = false;
            this._emit('close', {});
        });
    }
    // ── newPage ───────────────────────────────────────────────────────────────
    newPage() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._handle)
                throw new Error('[Browser] not launched');
            return this._handle.newPage();
        });
    }
    // ── default page helper ───────────────────────────────────────────────────
    _getDefaultPage() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._defaultPage) {
                this._defaultPage = yield this._handle.newPage();
            }
            return this._defaultPage;
        });
    }
    // ── Action wrapper ────────────────────────────────────────────────────────
    _action(name, fn, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!this._launched) {
                return { ok: false, error: 'not launched', durationMs: 0 };
            }
            const merged = Object.assign(Object.assign({}, this._defaultLaunchOpts), opts);
            const timeoutMs = (_a = merged.actionTimeoutMs) !== null && _a !== void 0 ? _a : 30000;
            const start = this._clock();
            try {
                const page = yield this._getDefaultPage();
                const data = yield withTimeout(fn(page), timeoutMs, name);
                const durationMs = this._clock() - start;
                this._emit('action', { name, ok: true, durationMs });
                return { ok: true, data, durationMs };
            }
            catch (e) {
                const durationMs = this._clock() - start;
                const msg = (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e);
                const isTimeout = msg.toLowerCase().includes('timeout');
                const error = isTimeout ? 'timeout' : msg;
                this._emit('action', { name, ok: false, durationMs });
                return { ok: false, error, durationMs };
            }
        });
    }
    // ── navigate ──────────────────────────────────────────────────────────────
    navigate(url) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!this._launched) {
                return { ok: false, error: 'not launched', durationMs: 0 };
            }
            const timeoutMs = (_a = this._defaultLaunchOpts.actionTimeoutMs) !== null && _a !== void 0 ? _a : 30000;
            const start = this._clock();
            try {
                const page = yield this._getDefaultPage();
                yield withTimeout(page.goto(url), timeoutMs, 'navigate');
                const title = yield page.title();
                const finalUrl = page.url();
                const durationMs = this._clock() - start;
                const data = { url: finalUrl, title };
                this._emit('navigate', { url: finalUrl, title });
                this._emit('action', { name: 'navigate', ok: true, durationMs });
                return { ok: true, data, durationMs };
            }
            catch (e) {
                const durationMs = this._clock() - start;
                const msg = (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e);
                const isTimeout = msg.toLowerCase().includes('timeout');
                const error = isTimeout ? 'timeout' : msg;
                this._emit('action', { name: 'navigate', ok: false, durationMs });
                return { ok: false, error, durationMs };
            }
        });
    }
    // ── click ─────────────────────────────────────────────────────────────────
    click(selector) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._action('click', (p) => p.click(selector));
        });
    }
    // ── type ──────────────────────────────────────────────────────────────────
    type(selector, text, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._action('type', (p) => p.type(selector, text, opts));
        });
    }
    // ── getText ───────────────────────────────────────────────────────────────
    getText(selector) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._action('getText', (p) => p.getText(selector));
        });
    }
    // ── screenshot ────────────────────────────────────────────────────────────
    screenshot(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._action('screenshot', (p) => p.screenshot(opts));
        });
    }
    // ── evaluate ──────────────────────────────────────────────────────────────
    evaluate(fn, arg) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._action('evaluate', (p) => p.evaluate(fn, arg));
        });
    }
    // ── isLaunched ────────────────────────────────────────────────────────────
    isLaunched() {
        return this._launched;
    }
}
// ── Public factory ────────────────────────────────────────────────────────────
export function createBrowserController(opts) {
    return new BrowserControllerImpl(opts);
}
