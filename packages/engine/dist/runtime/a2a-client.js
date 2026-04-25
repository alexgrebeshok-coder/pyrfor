/**
 * a2a-client.ts — Pyrfor A2A (Agent-to-Agent) protocol client.
 *
 * Allows Pyrfor to discover, register, and call remote agents over HTTP/JSON.
 *
 * Protocol endpoints expected on each remote agent:
 *   GET  {baseUrl}/.well-known/a2a-card       → { name, version, skills[] }
 *   POST {baseUrl}/skills/{skill}/invoke       → { output } | { error }
 *
 * Mirrors the structural patterns of acp-client.ts and mcp-client.ts but uses
 * Node global fetch (Node 20+) instead of stdio transports.
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
// ── Internal: timeout error ────────────────────────────────────────────────────
class TimeoutError extends Error {
    constructor() {
        super('timeout');
        this.name = 'TimeoutError';
    }
}
// ── A2AClientImpl ─────────────────────────────────────────────────────────────
class A2AClientImpl {
    constructor(opts = {}) {
        var _a, _b, _c, _d, _e;
        this._agents = new Map();
        this._skills = new Map();
        this._listeners = new Map();
        this._shuttingDown = false;
        this._fetch = (_a = opts.fetchImpl) !== null && _a !== void 0 ? _a : globalThis.fetch.bind(globalThis);
        this._retries = (_b = opts.retries) !== null && _b !== void 0 ? _b : 1;
        this._retryBackoffMs = (_c = opts.retryBackoffMs) !== null && _c !== void 0 ? _c : 250;
        this._log = (_d = opts.logger) !== null && _d !== void 0 ? _d : (() => { });
        this._clock = (_e = opts.clock) !== null && _e !== void 0 ? _e : (() => Date.now());
    }
    // ── Event bus ──────────────────────────────────────────────────────────────
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
                this._log('warn', `[A2A] Event subscriber threw on '${event}'`, { error: String(e) });
            }
        }
    }
    // ── register ───────────────────────────────────────────────────────────────
    register(cfg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this._agents.has(cfg.name)) {
                throw new Error(`[A2A] duplicate agent name: '${cfg.name}'`);
            }
            const url = `${cfg.baseUrl}/.well-known/a2a-card`;
            const headers = this._buildHeaders(cfg);
            const timeoutMs = (_a = cfg.startupTimeoutMs) !== null && _a !== void 0 ? _a : 10000;
            this._log('info', `[A2A] Registering agent '${cfg.name}'…`);
            let res;
            try {
                res = yield this._fetchWithTimeout(url, { headers }, timeoutMs);
            }
            catch (e) {
                this._log('error', `[A2A] Failed to fetch card for '${cfg.name}'`, { error: String(e) });
                throw e;
            }
            // Throws SyntaxError if body is not valid JSON — which is the intended
            // behaviour for "card non-JSON → register rejects".
            const body = yield res.json();
            const rawSkills = Array.isArray(body === null || body === void 0 ? void 0 : body.skills) ? body.skills : [];
            const skills = rawSkills.map((s) => {
                var _a, _b, _c;
                return ({
                    agentName: cfg.name,
                    skill: (_c = (_b = (_a = s.skill) !== null && _a !== void 0 ? _a : s.id) !== null && _b !== void 0 ? _b : s.name) !== null && _c !== void 0 ? _c : '',
                    description: s.description,
                    inputSchema: s.inputSchema,
                    outputSchema: s.outputSchema,
                });
            });
            this._agents.set(cfg.name, cfg);
            this._skills.set(cfg.name, skills);
            this._log('info', `[A2A] Registered agent '${cfg.name}', ${skills.length} skill(s)`);
            this._emit('register', { agentName: cfg.name });
            for (const s of skills)
                this._emit('skill', s);
        });
    }
    // ── unregister ─────────────────────────────────────────────────────────────
    unregister(name) {
        return __awaiter(this, void 0, void 0, function* () {
            this._agents.delete(name);
            this._skills.delete(name);
            this._emit('unregister', { agentName: name });
            this._log('info', `[A2A] Unregistered agent '${name}'`);
        });
    }
    // ── shutdown ───────────────────────────────────────────────────────────────
    shutdown() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._shuttingDown && this._agents.size === 0)
                return;
            this._shuttingDown = true;
            this._agents.clear();
            this._skills.clear();
        });
    }
    // ── registry ───────────────────────────────────────────────────────────────
    listAgents() {
        return [...this._agents.keys()];
    }
    listSkills(agentName) {
        var _a;
        if (agentName !== undefined)
            return (_a = this._skills.get(agentName)) !== null && _a !== void 0 ? _a : [];
        const all = [];
        for (const descriptors of this._skills.values())
            all.push(...descriptors);
        return all;
    }
    isRegistered(name) {
        return this._agents.has(name);
    }
    // ── call ───────────────────────────────────────────────────────────────────
    call(agentName, skill, input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const cfg = this._agents.get(agentName);
            if (!cfg) {
                return { ok: false, error: 'no such agent', durationMs: 0, retries: 0 };
            }
            const url = `${cfg.baseUrl}/skills/${skill}/invoke`;
            const timeoutMs = (_a = cfg.callTimeoutMs) !== null && _a !== void 0 ? _a : 60000;
            const callHeaders = Object.assign({ 'Content-Type': 'application/json' }, this._buildHeaders(cfg));
            const body = JSON.stringify({ input });
            const start = this._clock();
            let attempt = 0;
            while (true) {
                try {
                    const res = yield this._fetchWithTimeout(url, { method: 'POST', headers: callHeaders, body }, timeoutMs);
                    const durationMs = this._clock() - start;
                    if (res.ok) {
                        let resBody;
                        try {
                            resBody = yield res.json();
                        }
                        catch (_c) {
                            resBody = {};
                        }
                        const output = (resBody === null || resBody === void 0 ? void 0 : resBody.output) !== undefined ? resBody.output : resBody;
                        this._emit('call', { agentName, skill, ok: true, durationMs });
                        return { ok: true, output, raw: resBody, durationMs, retries: attempt };
                    }
                    // 5xx — retry if attempts remain
                    if (res.status >= 500 && attempt < this._retries) {
                        yield this._sleep(this._retryBackoffMs * (attempt + 1));
                        attempt++;
                        continue;
                    }
                    // 4xx or exhausted retries on 5xx — no further retry
                    let errMsg = `HTTP ${res.status}`;
                    try {
                        const errBody = yield res.json();
                        if (typeof (errBody === null || errBody === void 0 ? void 0 : errBody.error) === 'string')
                            errMsg = errBody.error;
                    }
                    catch ( /* keep HTTP status string */_d) { /* keep HTTP status string */ }
                    this._emit('call', { agentName, skill, ok: false, durationMs });
                    return { ok: false, error: errMsg, durationMs, retries: attempt };
                }
                catch (e) {
                    if (e instanceof TimeoutError) {
                        const durationMs = this._clock() - start;
                        this._emit('call', { agentName, skill, ok: false, durationMs });
                        return { ok: false, error: 'timeout', durationMs, retries: attempt };
                    }
                    // Network / transient error — retry if attempts remain
                    if (attempt < this._retries) {
                        yield this._sleep(this._retryBackoffMs * (attempt + 1));
                        attempt++;
                        continue;
                    }
                    const durationMs = this._clock() - start;
                    this._emit('call', { agentName, skill, ok: false, durationMs });
                    return {
                        ok: false,
                        error: (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e),
                        durationMs,
                        retries: attempt,
                    };
                }
            }
        });
    }
    // ── helpers ────────────────────────────────────────────────────────────────
    _buildHeaders(cfg) {
        var _a;
        const h = Object.assign({}, ((_a = cfg.headers) !== null && _a !== void 0 ? _a : {}));
        if (cfg.authToken)
            h['Authorization'] = `Bearer ${cfg.authToken}`;
        return h;
    }
    /**
     * Wraps a fetch call with a racing Promise-based timeout so fake timers
     * in tests can trigger the timeout without needing AbortController support.
     */
    _fetchWithTimeout(url, init, timeoutMs) {
        return __awaiter(this, void 0, void 0, function* () {
            let timeoutHandle;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new TimeoutError()), timeoutMs);
            });
            try {
                const res = yield Promise.race([this._fetch(url, init), timeoutPromise]);
                clearTimeout(timeoutHandle);
                return res;
            }
            catch (e) {
                clearTimeout(timeoutHandle);
                throw e;
            }
        });
    }
    _sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
}
// ── Public factory ────────────────────────────────────────────────────────────
export function createA2AClient(opts) {
    return new A2AClientImpl(opts);
}
