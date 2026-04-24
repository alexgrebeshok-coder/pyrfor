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

// ── Public types ──────────────────────────────────────────────────────────────

export type McpTransportKind = 'stdio' | 'sse';

export interface McpServerConfig {
  name: string;
  transport: McpTransportKind;
  // stdio-specific:
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // sse-specific:
  url?: string;
  headers?: Record<string, string>;
  // common:
  startupTimeoutMs?: number; // default 10_000
  callTimeoutMs?: number;    // default 60_000
}

export interface McpToolDescriptor {
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  content?: any;
  raw?: unknown;
  error?: string;
  durationMs: number;
}

export interface McpClient {
  connect(cfg: McpServerConfig): Promise<void>;
  disconnect(name: string): Promise<void>;
  shutdown(): Promise<void>;
  listServers(): string[];
  listTools(serverName?: string): McpToolDescriptor[];
  call(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult>;
  isConnected(name: string): boolean;
  on(event: 'connect' | 'disconnect' | 'tool', cb: (payload: any) => void): () => void;
}

export interface McpServerHandle {
  name: string;
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema: any }>>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content?: any; raw?: unknown }>;
  close(): Promise<void>;
}

export interface CreateMcpClientOptions {
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  timeoutMs?: number;
  /** SDK injection for tests — lets us pass a fake instead of importing the real one. */
  sdkFactory?: (cfg: McpServerConfig) => Promise<McpServerHandle>;
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

// ── Default SDK factory ───────────────────────────────────────────────────────

async function buildSdkHandle(cfg: McpServerConfig): Promise<McpServerHandle> {
  // Lazy-import so the module is tree-shakeable and tests can skip.
  let clientMod: any;
  try {
    clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
  } catch (e) {
    throw new Error(
      `[MCP] Failed to import @modelcontextprotocol/sdk/client/index.js: ${String(e)}`,
    );
  }

  const { Client } = clientMod;
  if (typeof Client !== 'function') {
    throw new Error('[MCP] @modelcontextprotocol/sdk Client export has unexpected shape');
  }

  const sdkClient = new Client(
    { name: `pyrfor-mcp-${cfg.name}`, version: '0.1.0' },
    { capabilities: {} },
  );

  if (cfg.transport === 'stdio') {
    let transportMod: any;
    try {
      transportMod = await import('@modelcontextprotocol/sdk/client/stdio.js');
    } catch (e) {
      throw new Error(`[MCP] Failed to import stdio transport: ${String(e)}`);
    }
    const { StdioClientTransport } = transportMod;
    const transport = new StdioClientTransport({
      command: cfg.command!,
      args: cfg.args,
      env: cfg.env,
      cwd: cfg.cwd,
    });
    await sdkClient.connect(transport);
  } else {
    // SSE
    let transportMod: any;
    try {
      transportMod = await import('@modelcontextprotocol/sdk/client/sse.js');
    } catch (e) {
      throw new Error(`[MCP] Failed to import SSE transport: ${String(e)}`);
    }
    const { SSEClientTransport } = transportMod;
    const transport = new SSEClientTransport(new URL(cfg.url!), {
      headers: cfg.headers,
    });
    await sdkClient.connect(transport);
  }

  return {
    name: cfg.name,
    async listTools() {
      const result = await sdkClient.listTools();
      return result.tools as Array<{ name: string; description?: string; inputSchema: any }>;
    },
    async callTool(name, args) {
      const result = await sdkClient.callTool({ name, arguments: args });
      return { content: result.content, raw: result };
    },
    async close() {
      try {
        await sdkClient.close();
      } catch {
        // best-effort
      }
    },
  };
}

// ── McpClientImpl ─────────────────────────────────────────────────────────────

class McpClientImpl implements McpClient {
  private readonly _handles = new Map<string, McpServerHandle>();
  private readonly _toolCache = new Map<string, McpToolDescriptor[]>();
  private readonly _listeners = new Map<string, Set<(payload: any) => void>>();
  private _shuttingDown = false;

  private readonly _log: NonNullable<CreateMcpClientOptions['logger']>;
  private readonly _sdkFactory: (cfg: McpServerConfig) => Promise<McpServerHandle>;

  constructor(opts: CreateMcpClientOptions = {}) {
    this._log = opts.logger ?? (() => {});
    this._sdkFactory = opts.sdkFactory ?? buildSdkHandle;
  }

  // ── Event emitter ────────────────────────────────────────────────────────

  on(event: 'connect' | 'disconnect' | 'tool', cb: (payload: any) => void): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(cb);
    return () => {
      this._listeners.get(event)?.delete(cb);
    };
  }

  private _emit(event: string, payload: any): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (e) {
        this._log('warn', `[MCP] Event subscriber threw on '${event}'`, { error: String(e) });
      }
    }
  }

  // ── connect ──────────────────────────────────────────────────────────────

  async connect(cfg: McpServerConfig): Promise<void> {
    if (this._handles.has(cfg.name)) {
      throw new Error(`[MCP] duplicate server name: '${cfg.name}'`);
    }

    const startupMs = cfg.startupTimeoutMs ?? 10_000;

    this._log('info', `[MCP] Connecting to server '${cfg.name}' (${cfg.transport})…`);

    let handle: McpServerHandle;
    try {
      handle = await withTimeout(
        this._sdkFactory(cfg),
        startupMs,
        `connect '${cfg.name}'`,
      );
    } catch (e) {
      this._log('error', `[MCP] Failed to connect to '${cfg.name}'`, { error: String(e) });
      throw e;
    }

    // Fetch tool list — also subject to startup timeout (already consumed some of it,
    // but we give a fresh window so a slow tool-list doesn't hide behind connect time).
    let rawTools: Array<{ name: string; description?: string; inputSchema: any }>;
    try {
      rawTools = await withTimeout(
        handle.listTools(),
        startupMs,
        `listTools '${cfg.name}'`,
      );
    } catch (e) {
      this._log('error', `[MCP] listTools failed for '${cfg.name}'`, { error: String(e) });
      try { await handle.close(); } catch { /* ignore */ }
      throw e;
    }

    this._handles.set(cfg.name, handle);

    const descriptors: McpToolDescriptor[] = rawTools.map((t) => ({
      serverName: cfg.name,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? {},
    }));
    this._toolCache.set(cfg.name, descriptors);

    this._log('info', `[MCP] Connected to '${cfg.name}', ${descriptors.length} tool(s)`);
    this._emit('connect', { serverName: cfg.name });
    for (const d of descriptors) {
      this._emit('tool', d);
    }
  }

  // ── disconnect ───────────────────────────────────────────────────────────

  async disconnect(name: string): Promise<void> {
    const handle = this._handles.get(name);
    if (!handle) return;

    try {
      await handle.close();
    } catch (e) {
      this._log('warn', `[MCP] Error closing handle for '${name}'`, { error: String(e) });
    }

    this._handles.delete(name);
    this._toolCache.delete(name);
    this._emit('disconnect', { serverName: name });
    this._log('info', `[MCP] Disconnected from '${name}'`);
  }

  // ── shutdown ─────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this._shuttingDown && this._handles.size === 0) return;
    this._shuttingDown = true;

    const names = [...this._handles.keys()];
    await Promise.allSettled(names.map((n) => this.disconnect(n)));
  }

  // ── registry ─────────────────────────────────────────────────────────────

  listServers(): string[] {
    return [...this._handles.keys()];
  }

  listTools(serverName?: string): McpToolDescriptor[] {
    if (serverName !== undefined) {
      return this._toolCache.get(serverName) ?? [];
    }
    const all: McpToolDescriptor[] = [];
    for (const descriptors of this._toolCache.values()) {
      all.push(...descriptors);
    }
    return all;
  }

  isConnected(name: string): boolean {
    return this._handles.has(name);
  }

  // ── call ─────────────────────────────────────────────────────────────────

  async call(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
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
      const raw = await withTimeout(resultPromise, callTimeoutMs, `call '${toolName}'`);
      const durationMs = Date.now() - start;
      return { ok: true, content: raw.content, raw, durationMs };
    } catch (e: any) {
      const durationMs = Date.now() - start;
      const msg: string = e?.message ?? String(e);
      const isTimeout = msg.includes('timeout');
      return {
        ok: false,
        error: isTimeout ? 'timeout' : msg,
        durationMs,
      };
    }
  }

  // We store per-server call timeout alongside connect config.
  private readonly _callTimeouts = new Map<string, number>();

  /** Override connect to capture callTimeoutMs per server. */
  // NOTE: We shadow this in the wrapper below.

  _setCallTimeout(name: string, ms: number): void {
    this._callTimeouts.set(name, ms);
  }

  private _callTimeoutFor(name: string): number {
    return this._callTimeouts.get(name) ?? 60_000;
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
export function createMcpClient(opts?: CreateMcpClientOptions): McpClient {
  const impl = new McpClientImpl(opts);

  // Wrap connect to capture callTimeoutMs before delegating.
  const originalConnect = impl.connect.bind(impl);
  const wrapped: McpClient = {
    connect: async (cfg: McpServerConfig) => {
      impl._setCallTimeout(cfg.name, cfg.callTimeoutMs ?? 60_000);
      return originalConnect(cfg);
    },
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
