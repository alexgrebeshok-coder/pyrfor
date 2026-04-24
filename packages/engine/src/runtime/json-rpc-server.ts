// @vitest-environment node

// ── JSON-RPC 2.0 types ──────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMethod = (
  params: unknown,
  ctx: { id: string | number | null; signal?: AbortSignal },
) => Promise<unknown> | unknown;

// ── Standard error codes ────────────────────────────────────────────────────

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
// const INVALID_PARAMS = -32602; // reserved for handler use
const INTERNAL_ERROR = -32603;

// ── Options ─────────────────────────────────────────────────────────────────

export interface JsonRpcServerOptions {
  onError?: (err: Error, ctx: unknown) => void;
  maxBatchSize?: number;
  defaultTimeoutMs?: number;
  clock?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

// ── Stats ───────────────────────────────────────────────────────────────────

interface MethodStats {
  calls: number;
  errors: number;
  totalMs: number;
}

interface Stats {
  calls: number;
  errors: number;
  perMethod: Record<string, MethodStats>;
}

// ── Server instance ─────────────────────────────────────────────────────────

export interface JsonRpcServer {
  register(method: string, handler: JsonRpcMethod): () => void;
  unregister(method: string): boolean;
  handle(payload: string | object | object[]): Promise<string | null>;
  handleObject(
    payload: object | object[],
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null>;
  getRegisteredMethods(): string[];
  getStats(): Stats;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createJsonRpcServer(opts: JsonRpcServerOptions = {}): JsonRpcServer {
  const {
    onError,
    maxBatchSize = 100,
    defaultTimeoutMs,
    clock = () => Date.now(),
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  const methods = new Map<string, JsonRpcMethod>();
  const stats: Stats = { calls: 0, errors: 0, perMethod: {} };

  function ensureMethodStats(method: string): MethodStats {
    if (!stats.perMethod[method]) {
      stats.perMethod[method] = { calls: 0, errors: 0, totalMs: 0 };
    }
    return stats.perMethod[method];
  }

  function errorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    const err: JsonRpcError = { code, message };
    if (data !== undefined) err.data = data;
    return { jsonrpc: '2.0', error: err, id };
  }

  function isRpcError(v: unknown): v is { code: number; message: string; data?: unknown } {
    return (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Record<string, unknown>).code === 'number' &&
      typeof (v as Record<string, unknown>).message === 'string'
    );
  }

  async function dispatchOne(req: unknown): Promise<JsonRpcResponse | null> {
    // Validate shape
    if (typeof req !== 'object' || req === null || Array.isArray(req)) {
      return errorResponse(null, INVALID_REQUEST, 'Invalid Request');
    }

    const r = req as Record<string, unknown>;

    if (r.jsonrpc !== '2.0') {
      const id = r.id !== undefined ? (r.id as string | number | null) : null;
      return errorResponse(id, INVALID_REQUEST, 'Invalid Request');
    }

    if (typeof r.method !== 'string' || r.method === '') {
      const id = r.id !== undefined ? (r.id as string | number | null) : null;
      return errorResponse(id, INVALID_REQUEST, 'Invalid Request');
    }

    const isNotification = !('id' in r);
    const id: string | number | null = isNotification
      ? null
      : (r.id as string | number | null) ?? null;

    const method = r.method as string;
    const params = r.params;

    stats.calls++;
    ensureMethodStats(method).calls++;

    const handler = methods.get(method);
    if (!handler) {
      stats.errors++;
      ensureMethodStats(method).errors++;
      if (isNotification) return null;
      return errorResponse(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }

    const start = clock();

    try {
      let result: unknown;

      if (defaultTimeoutMs !== undefined) {
        const ac = new AbortController();
        let timerHandle: unknown;

        const timeoutPromise = new Promise<never>((_, reject) => {
          timerHandle = setTimer(() => {
            ac.abort();
            reject(new Error('Method timeout'));
          }, defaultTimeoutMs);
        });

        try {
          result = await Promise.race([
            Promise.resolve(handler(params, { id, signal: ac.signal })),
            timeoutPromise,
          ]);
        } finally {
          clearTimer(timerHandle);
        }
      } else {
        result = await Promise.resolve(handler(params, { id }));
      }

      const elapsed = clock() - start;
      ensureMethodStats(method).totalMs += elapsed;

      if (isNotification) return null;
      return { jsonrpc: '2.0', result, id };
    } catch (err: unknown) {
      const elapsed = clock() - start;
      ensureMethodStats(method).totalMs += elapsed;
      stats.errors++;
      ensureMethodStats(method).errors++;

      if (onError && err instanceof Error) onError(err, { method, id });

      if (isNotification) return null;

      if (isRpcError(err)) {
        return errorResponse(id, err.code, err.message, err.data);
      }

      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(id, INTERNAL_ERROR, message);
    }
  }

  async function handleObject(
    payload: object | object[],
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        return errorResponse(null, INVALID_REQUEST, 'Invalid Request');
      }
      if (payload.length > maxBatchSize) {
        return errorResponse(null, INVALID_REQUEST, 'Batch too large');
      }
      const results = await Promise.all(payload.map((item) => dispatchOne(item)));
      const filtered = results.filter((r): r is JsonRpcResponse => r !== null);
      return filtered.length === 0 ? null : filtered;
    }
    return dispatchOne(payload);
  }

  async function handle(
    payload: string | object | object[],
  ): Promise<string | null> {
    let parsed: object | object[];

    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload) as object | object[];
      } catch {
        const resp = errorResponse(null, PARSE_ERROR, 'Parse error');
        return JSON.stringify(resp);
      }
    } else {
      parsed = payload;
    }

    const result = await handleObject(parsed);
    if (result === null) return null;
    return JSON.stringify(result);
  }

  return {
    register(method: string, handler: JsonRpcMethod): () => void {
      methods.set(method, handler);
      return () => { methods.delete(method); };
    },

    unregister(method: string): boolean {
      return methods.delete(method);
    },

    handle,
    handleObject,

    getRegisteredMethods(): string[] {
      return Array.from(methods.keys());
    },

    getStats(): Stats {
      return stats;
    },
  };
}
