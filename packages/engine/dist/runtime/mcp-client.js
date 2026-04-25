/**
 * mcp-client.ts — Pyrfor MCP (Model Context Protocol) client wrapper.
 *
 * Thin façade over @modelcontextprotocol/sdk that:
 *   - Connects to MCP servers via stdio or SSE transports.
 *   - Discovers tools and maintains a per-server tool cache.
 *   - Exposes a unified call() API + a registry other Pyrfor modules can query.
 *   - Emits lifecycle events ('connect', 'disconnect', 'tool').
 *
 * SDK is lazy-imported so callers that never connect to real servers avoid
 * the import cost; tests inject a fake via CreateMcpClientOptions.sdkFactory.
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
// ── Default SDK factory ───────────────────────────────────────────────────────
function buildSdkHandle(cfg) {
    return __awaiter(this, void 0, void 0, function* () {
        // Lazy-import so the module is tree-shakeable and tests can skip.
        let clientMod;
        try {
            clientMod = yield import('@modelcontextprotocol/sdk/client/index.js');
        }
        catch (e) {
            throw new Error(`[MCP] Failed to import @modelcontextprotocol/sdk/client/index.js: ${String(e)}`);
        }
        const { Client } = clientMod;
        if (typeof Client !== 'function') {
            throw new Error('[MCP] @modelcontextprotocol/sdk Client export has unexpected shape');
        }
        const sdkClient = new Client({ name: `pyrfor-mcp-${cfg.name}`, version: '0.1.0' }, { capabilities: {} });
        if (cfg.transport === 'stdio') {
            let transportMod;
            try {
                transportMod = yield import('@modelcontextprotocol/sdk/client/stdio.js');
            }
            catch (e) {
                throw new Error(`[MCP] Failed to import stdio transport: ${String(e)}`);
            }
            const { StdioClientTransport } = transportMod;
            const transport = new StdioClientTransport({
                command: cfg.command,
                args: cfg.args,
                env: cfg.env,
                cwd: cfg.cwd,
            });
            yield sdkClient.connect(transport);
        }
        else {
            // SSE
            let transportMod;
            try {
                transportMod = yield import('@modelcontextprotocol/sdk/client/sse.js');
            }
            catch (e) {
                throw new Error(`[MCP] Failed to import SSE transport: ${String(e)}`);
            }
            const { SSEClientTransport } = transportMod;
            const transport = new SSEClientTransport(new URL(cfg.url), {
                headers: cfg.headers,
            });
            yield sdkClient.connect(transport);
        }
        return {
            name: cfg.name,
            listTools() {
                return __awaiter(this, void 0, void 0, function* () {
                    const result = yield sdkClient.listTools();
                    return result.tools;
                });
            },
            callTool(name, args) {
                return __awaiter(this, void 0, void 0, function* () {
                    const result = yield sdkClient.callTool({ name, arguments: args });
                    return { content: result.content, raw: result };
                });
            },
            close() {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield sdkClient.close();
                    }
                    catch (_a) {
                        // best-effort
                    }
                });
            },
        };
    });
}
// ── McpClientImpl ─────────────────────────────────────────────────────────────
class McpClientImpl {
    constructor(opts = {}) {
        var _a, _b;
        this._handles = new Map();
        this._toolCache = new Map();
        this._listeners = new Map();
        this._shuttingDown = false;
        // We store per-server call timeout alongside connect config.
        this._callTimeouts = new Map();
        this._log = (_a = opts.logger) !== null && _a !== void 0 ? _a : (() => { });
        this._sdkFactory = (_b = opts.sdkFactory) !== null && _b !== void 0 ? _b : buildSdkHandle;
    }
    // ── Event emitter ────────────────────────────────────────────────────────
    on(event, cb) {
        let set = this._listeners.get(event);
        if (!set) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(cb);
        return () => {
            var _a;
            (_a = this._listeners.get(event)) === null || _a === void 0 ? void 0 : _a.delete(cb);
        };
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
                this._log('warn', `[MCP] Event subscriber threw on '${event}'`, { error: String(e) });
            }
        }
    }
    // ── connect ──────────────────────────────────────────────────────────────
    connect(cfg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this._handles.has(cfg.name)) {
                throw new Error(`[MCP] duplicate server name: '${cfg.name}'`);
            }
            const startupMs = (_a = cfg.startupTimeoutMs) !== null && _a !== void 0 ? _a : 10000;
            this._log('info', `[MCP] Connecting to server '${cfg.name}' (${cfg.transport})…`);
            let handle;
            try {
                handle = yield withTimeout(this._sdkFactory(cfg), startupMs, `connect '${cfg.name}'`);
            }
            catch (e) {
                this._log('error', `[MCP] Failed to connect to '${cfg.name}'`, { error: String(e) });
                throw e;
            }
            // Fetch tool list — also subject to startup timeout (already consumed some of it,
            // but we give a fresh window so a slow tool-list doesn't hide behind connect time).
            let rawTools;
            try {
                rawTools = yield withTimeout(handle.listTools(), startupMs, `listTools '${cfg.name}'`);
            }
            catch (e) {
                this._log('error', `[MCP] listTools failed for '${cfg.name}'`, { error: String(e) });
                try {
                    yield handle.close();
                }
                catch ( /* ignore */_b) { /* ignore */ }
                throw e;
            }
            this._handles.set(cfg.name, handle);
            const descriptors = rawTools.map((t) => {
                var _a;
                return ({
                    serverName: cfg.name,
                    name: t.name,
                    description: t.description,
                    inputSchema: (_a = t.inputSchema) !== null && _a !== void 0 ? _a : {},
                });
            });
            this._toolCache.set(cfg.name, descriptors);
            this._log('info', `[MCP] Connected to '${cfg.name}', ${descriptors.length} tool(s)`);
            this._emit('connect', { serverName: cfg.name });
            for (const d of descriptors) {
                this._emit('tool', d);
            }
        });
    }
    // ── disconnect ───────────────────────────────────────────────────────────
    disconnect(name) {
        return __awaiter(this, void 0, void 0, function* () {
            const handle = this._handles.get(name);
            if (!handle)
                return;
            try {
                yield handle.close();
            }
            catch (e) {
                this._log('warn', `[MCP] Error closing handle for '${name}'`, { error: String(e) });
            }
            this._handles.delete(name);
            this._toolCache.delete(name);
            this._emit('disconnect', { serverName: name });
            this._log('info', `[MCP] Disconnected from '${name}'`);
        });
    }
    // ── shutdown ─────────────────────────────────────────────────────────────
    shutdown() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._shuttingDown && this._handles.size === 0)
                return;
            this._shuttingDown = true;
            const names = [...this._handles.keys()];
            yield Promise.allSettled(names.map((n) => this.disconnect(n)));
        });
    }
    // ── registry ─────────────────────────────────────────────────────────────
    listServers() {
        return [...this._handles.keys()];
    }
    listTools(serverName) {
        var _a;
        if (serverName !== undefined) {
            return (_a = this._toolCache.get(serverName)) !== null && _a !== void 0 ? _a : [];
        }
        const all = [];
        for (const descriptors of this._toolCache.values()) {
            all.push(...descriptors);
        }
        return all;
    }
    isConnected(name) {
        return this._handles.has(name);
    }
    // ── call ─────────────────────────────────────────────────────────────────
    call(serverName, toolName, args) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const handle = this._handles.get(serverName);
            if (!handle) {
                return { ok: false, error: 'no such server', durationMs: 0 };
            }
            // Determine per-server callTimeoutMs from the config stored at connect time.
            // Since we don't re-store configs, fall back to a generous default.
            const callTimeoutMs = this._callTimeoutFor(serverName);
            const start = Date.now();
            try {
                const resultPromise = handle.callTool(toolName, args);
                const raw = yield withTimeout(resultPromise, callTimeoutMs, `call '${toolName}'`);
                const durationMs = Date.now() - start;
                return { ok: true, content: raw.content, raw, durationMs };
            }
            catch (e) {
                const durationMs = Date.now() - start;
                const msg = (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(e);
                const isTimeout = msg.includes('timeout');
                return {
                    ok: false,
                    error: isTimeout ? 'timeout' : msg,
                    durationMs,
                };
            }
        });
    }
    /** Override connect to capture callTimeoutMs per server. */
    // NOTE: We shadow this in the wrapper below.
    _setCallTimeout(name, ms) {
        this._callTimeouts.set(name, ms);
    }
    _callTimeoutFor(name) {
        var _a;
        return (_a = this._callTimeouts.get(name)) !== null && _a !== void 0 ? _a : 60000;
    }
}
// ── Public factory ────────────────────────────────────────────────────────────
/**
 * Create a new MCP client.
 *
 * Inject `sdkFactory` in tests to avoid spawning real child processes.
 * The returned client implements McpClient but also stores per-server call
 * timeouts so connect() → call() timeout chains work correctly.
 */
export function createMcpClient(opts) {
    const impl = new McpClientImpl(opts);
    // Wrap connect to capture callTimeoutMs before delegating.
    const originalConnect = impl.connect.bind(impl);
    const wrapped = {
        connect: (cfg) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            impl._setCallTimeout(cfg.name, (_a = cfg.callTimeoutMs) !== null && _a !== void 0 ? _a : 60000);
            return originalConnect(cfg);
        }),
        disconnect: impl.disconnect.bind(impl),
        shutdown: impl.shutdown.bind(impl),
        listServers: impl.listServers.bind(impl),
        listTools: impl.listTools.bind(impl),
        call: impl.call.bind(impl),
        isConnected: impl.isConnected.bind(impl),
        on: impl.on.bind(impl),
    };
    return wrapped;
}
