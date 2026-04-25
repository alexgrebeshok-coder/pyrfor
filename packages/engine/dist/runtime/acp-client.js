/**
 * ACP Client — Agent-Client-Protocol (JSON-RPC 2.0 over child-process stdio)
 *
 * Implements the March 2026 ACP spec for Pyrfor to supervise external coding
 * agents (FreeClaude, Codex CLI, ClaudeCode, Gemini CLI, Cursor).
 *
 * Wire format: line-delimited JSON  (each message ends with '\n').
 * Transport: child-process stdin (client→agent) / stdout (agent→client).
 *
 * Back-pressure note: The per-session EventQueue is unbounded. Events pile up
 * in a plain array if the consumer iterates slowly. For production with
 * high-throughput agents, cap the queue at ~1 000 events and apply flow
 * control at the transport layer.
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { spawn } from 'node:child_process';
// ── Error types ───────────────────────────────────────────────────────────────
export class AcpTimeoutError extends Error {
    constructor(method, ms) {
        super(`ACP request "${method}" timed out after ${ms}ms`);
        this.name = 'AcpTimeoutError';
    }
}
// ── Internal: EventQueue ──────────────────────────────────────────────────────
class EventQueue {
    constructor() {
        this.buf = [];
        this.waiter = null;
        this._done = false;
    }
    push(event) {
        this.buf.push(event);
        const w = this.waiter;
        this.waiter = null;
        w === null || w === void 0 ? void 0 : w();
    }
    close() {
        if (this._done)
            return;
        this._done = true;
        const w = this.waiter;
        this.waiter = null;
        w === null || w === void 0 ? void 0 : w();
    }
    get done() {
        return this._done;
    }
    [Symbol.asyncIterator]() {
        return __asyncGenerator(this, arguments, function* _a() {
            while (true) {
                while (this.buf.length > 0) {
                    yield yield __await(this.buf.shift());
                }
                if (this._done)
                    return yield __await(void 0);
                yield __await(new Promise((r) => {
                    this.waiter = r;
                }));
            }
        });
    }
}
function isRpcResponse(m) {
    return typeof m === 'object' && m !== null && 'id' in m && !('method' in m);
}
function isRpcRequest(m) {
    return typeof m === 'object' && m !== null && 'id' in m && 'method' in m;
}
function isRpcNotification(m) {
    return typeof m === 'object' && m !== null && !('id' in m) && 'method' in m;
}
// ── SessionImpl ───────────────────────────────────────────────────────────────
class SessionImpl {
    constructor(id, cwd, _c) {
        this._c = _c;
        this._closed = false;
        this._queue = new EventQueue();
        this.activePrompt = null;
        this.id = id;
        this.cwd = cwd;
    }
    prompt(text) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this._closed)
                throw new Error(`Session ${this.id} is closed`);
            if (this.activePrompt)
                throw new Error(`A prompt is already active on session ${this.id}`);
            const requestId = this._c._nextId();
            const collector = [];
            const timeoutMs = (_a = this._c.opts.requestTimeoutMs) !== null && _a !== void 0 ? _a : 60000;
            return new Promise((outerResolve, outerReject) => {
                const timer = setTimeout(() => {
                    var _a;
                    this._c._pending.delete(requestId);
                    if (((_a = this.activePrompt) === null || _a === void 0 ? void 0 : _a.requestId) === requestId) {
                        this.activePrompt = null;
                    }
                    outerReject(new AcpTimeoutError('session/prompt', timeoutMs));
                    // Best-effort cancel so the agent cleans up its state.
                    this._c._cancelSession(this.id).catch(() => { });
                }, timeoutMs);
                this.activePrompt = {
                    requestId,
                    collector,
                    resolve: (result) => {
                        clearTimeout(timer);
                        outerResolve(result);
                    },
                    reject: (err) => {
                        clearTimeout(timer);
                        outerReject(err);
                    },
                };
                // Register in the shared pending map so _handleResponse can route back.
                this._c._pending.set(requestId, {
                    method: 'session/prompt',
                    resolve: (raw) => {
                        const r = raw;
                        const ap = this.activePrompt;
                        this.activePrompt = null;
                        ap === null || ap === void 0 ? void 0 : ap.resolve({ stopReason: r.stopReason, events: [...collector] });
                    },
                    reject: (err) => {
                        const ap = this.activePrompt;
                        this.activePrompt = null;
                        ap === null || ap === void 0 ? void 0 : ap.reject(err);
                    },
                });
                this._c._sendRaw({
                    jsonrpc: '2.0',
                    id: requestId,
                    method: 'session/prompt',
                    params: { sessionId: this.id, text },
                });
            });
        });
    }
    inject(text) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._closed)
                throw new Error(`Session ${this.id} is closed`);
            // Events emitted by the agent for this inject are automatically routed
            // into activePrompt.collector (if a prompt is still running) via
            // _handleNotification, so the outer prompt() call collects them all.
            yield this._c._sendRequest('session/prompt', { sessionId: this.id, text });
        });
    }
    cancel() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._c._cancelSession(this.id);
        });
    }
    events() {
        return this._queue;
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._closed)
                return;
            this._closed = true;
            this._queue.close();
            this._c._sessions.delete(this.id);
        });
    }
    /** Internal — called by client on unexpected exit or shutdown. */
    _forceClose() {
        if (this._closed)
            return;
        this._closed = true;
        this._queue.close();
    }
}
// ── AcpClientImpl ─────────────────────────────────────────────────────────────
class AcpClientImpl {
    constructor(opts) {
        var _a, _b;
        this._alive = true;
        this._idCounter = 0;
        this._lineBuf = '';
        this._pending = new Map();
        this._sessions = new Map();
        this.opts = opts;
        this._child = spawn(opts.command, (_a = opts.args) !== null && _a !== void 0 ? _a : [], {
            cwd: opts.cwd,
            env: Object.assign(Object.assign({}, process.env), ((_b = opts.env) !== null && _b !== void 0 ? _b : {})),
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        this._child.stdout.on('data', (chunk) => {
            var _a;
            this._lineBuf += chunk.toString('utf8');
            const lines = this._lineBuf.split('\n');
            this._lineBuf = (_a = lines.pop()) !== null && _a !== void 0 ? _a : '';
            for (const line of lines) {
                if (line.trim())
                    this._processLine(line);
            }
        });
        this._child.on('exit', (code, signal) => this._handleExit(code, signal));
        this._child.on('error', (err) => {
            this._log('error', 'ACP child process error', { error: err.message });
            this._handleExit(null, null);
        });
    }
    // ── helpers ────────────────────────────────────────────────────────────────
    _nextId() {
        return ++this._idCounter;
    }
    _log(level, msg, meta) {
        var _a, _b;
        (_b = (_a = this.opts).logger) === null || _b === void 0 ? void 0 : _b.call(_a, level, msg, meta);
    }
    _sendRaw(msg) {
        if (!this._alive)
            return;
        try {
            this._child.stdin.write(JSON.stringify(msg) + '\n');
        }
        catch (e) {
            this._log('error', 'Failed to write to ACP stdin', { error: String(e) });
        }
    }
    _sendRequest(method, params, timeoutMs) {
        var _a;
        const id = this._nextId();
        const ms = (_a = timeoutMs !== null && timeoutMs !== void 0 ? timeoutMs : this.opts.requestTimeoutMs) !== null && _a !== void 0 ? _a : 60000;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new AcpTimeoutError(method, ms));
            }, ms);
            this._pending.set(id, {
                method,
                resolve: (val) => { clearTimeout(timer); resolve(val); },
                reject: (err) => { clearTimeout(timer); reject(err); },
            });
            this._sendRaw({ jsonrpc: '2.0', id, method, params });
        });
    }
    _cancelSession(sessionId) {
        return this._sendRequest('session/cancel', { sessionId });
    }
    // ── line processing ────────────────────────────────────────────────────────
    _processLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch (_a) {
            this._log('warn', `Malformed JSON from ACP agent: ${line.slice(0, 200)}`);
            return;
        }
        if (isRpcResponse(msg))
            this._handleResponse(msg);
        else if (isRpcRequest(msg))
            this._handleRequest(msg);
        else if (isRpcNotification(msg))
            this._handleNotification(msg);
        else
            this._log('warn', 'Unrecognized JSON-RPC message shape', { msg });
    }
    _handleResponse(msg) {
        const p = this._pending.get(msg.id);
        if (!p) {
            this._log('warn', `Response for unknown request id=${msg.id}`);
            return;
        }
        this._pending.delete(msg.id);
        if (msg.error) {
            p.reject(new Error(`ACP [${p.method}] error ${msg.error.code}: ${msg.error.message}`));
        }
        else {
            p.resolve(msg.result);
        }
    }
    _handleNotification(msg) {
        var _a, _b, _d, _e;
        if (msg.method !== 'session/update') {
            this._log('warn', `Unknown notification method: ${msg.method}`);
            return;
        }
        const p = msg.params;
        const event = {
            sessionId: p.sessionId,
            type: p.type,
            data: p.data,
            ts: (_a = p.ts) !== null && _a !== void 0 ? _a : Date.now(),
        };
        (_d = (_b = this.opts).onEvent) === null || _d === void 0 ? void 0 : _d.call(_b, event);
        const session = this._sessions.get(p.sessionId);
        if (session) {
            session._queue.push(event);
            (_e = session.activePrompt) === null || _e === void 0 ? void 0 : _e.collector.push(event);
        }
    }
    _handleRequest(msg) {
        if (msg.method === 'session/request_permission') {
            const p = msg.params;
            const reply = (outcome) => this._sendRaw({ jsonrpc: '2.0', id: msg.id, result: { outcome } });
            const handler = this.opts.onPermissionRequest;
            if (!handler) {
                reply('allow');
                return;
            }
            Promise.resolve(handler({ sessionId: p.sessionId, tool: p.tool, args: p.args, kind: p.kind }))
                .then(reply)
                .catch(() => reply('deny'));
        }
        else {
            this._sendRaw({
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32601, message: `Method not found: ${msg.method}` },
            });
        }
    }
    _handleExit(code, signal) {
        if (!this._alive)
            return;
        this._alive = false;
        this._log('error', 'ACP agent exited', { code, signal });
        const err = new Error(`ACP agent process exited unexpectedly (code=${code !== null && code !== void 0 ? code : 'null'}, signal=${signal !== null && signal !== void 0 ? signal : 'null'})`);
        // Reject all in-flight requests. For active prompt() calls the custom
        // reject handler (installed by prompt()) will clear activePrompt and
        // reject the outer promise; so _forceClose only needs to drain the queue.
        for (const [, p] of this._pending)
            p.reject(err);
        this._pending.clear();
        for (const [, s] of this._sessions)
            s._forceClose();
        this._sessions.clear();
    }
    // ── AcpClient public API ───────────────────────────────────────────────────
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const ms = (_a = this.opts.startupTimeoutMs) !== null && _a !== void 0 ? _a : 10000;
            try {
                const result = yield this._sendRequest('initialize', {}, ms);
                return result;
            }
            catch (err) {
                this._child.kill();
                this._alive = false;
                throw err;
            }
        });
    }
    newSession(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _d;
            const cwd = (_b = (_a = opts === null || opts === void 0 ? void 0 : opts.cwd) !== null && _a !== void 0 ? _a : this.opts.cwd) !== null && _b !== void 0 ? _b : process.cwd();
            const result = yield this._sendRequest('session/new', Object.assign({ cwd }, ((_d = opts === null || opts === void 0 ? void 0 : opts.meta) !== null && _d !== void 0 ? _d : {})));
            const r = result;
            const session = new SessionImpl(r.sessionId, cwd, this);
            this._sessions.set(r.sessionId, session);
            return session;
        });
    }
    isAlive() {
        return this._alive;
    }
    shutdown() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._alive)
                return;
            // Gracefully cancel any sessions with an outstanding prompt.
            const cancels = [];
            for (const [, s] of this._sessions) {
                if (s.activePrompt)
                    cancels.push(s.cancel().catch(() => { }));
            }
            yield Promise.race([
                Promise.allSettled(cancels),
                new Promise((r) => setTimeout(r, 2000)),
            ]);
            this._alive = false;
            this._child.kill();
            for (const [, s] of this._sessions)
                s._forceClose();
            this._sessions.clear();
        });
    }
}
// ── Public factory ────────────────────────────────────────────────────────────
export function createAcpClient(opts) {
    return new AcpClientImpl(opts);
}
