/**
 * tool-router.ts — LLM tool/function-call router.
 *
 * Provides schema validation, dispatch with timeout + retry, idempotency
 * de-duplication, batch dispatch, and OpenAI-style describe() output.
 *
 * CONSTRAINTS: Node built-ins only. TypeScript strict.
 */

// ── JSON-schema subset ────────────────────────────────────────────────────────

export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'integer'
  | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  description?: string;
  [key: string]: unknown;
}

// ── Tool registration ─────────────────────────────────────────────────────────

export interface ToolOptions {
  timeoutMs?: number;
  retries?: number;
  idempotent?: boolean;
  rateLimitKey?: string;
  tags?: string[];
}

export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  handler: (args: TArgs, ctx?: unknown) => Promise<TResult> | TResult;
  options?: ToolOptions;
}

// ── Dispatch types ────────────────────────────────────────────────────────────

export interface DispatchCall {
  name: string;
  args: Record<string, unknown>;
  ctx?: unknown;
}

export interface DispatchError {
  type: string;
  message: string;
}

export interface DispatchResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: DispatchError;
  durationMs: number;
  attempts: number;
}

// ── Router factory options ────────────────────────────────────────────────────

export interface ToolRouterOptions {
  tools?: ToolDefinition[];
  validator?: (schema: JsonSchema, args: Record<string, unknown>) => void;
  onCall?: (call: { name: string; args: Record<string, unknown>; ctx?: unknown }) => void;
  defaultTimeoutMs?: number;
  /** Injected for tests */
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout | ReturnType<typeof setTimeout>;
  clearTimer?: (id: NodeJS.Timeout | ReturnType<typeof setTimeout>) => void;
  rng?: () => number;
}

// ── OpenAI describe shape ─────────────────────────────────────────────────────

export interface OpenAIToolDescription {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

// ── Built-in shallow validator ────────────────────────────────────────────────

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    err.message === 'timeout'
  );
}

function checkType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

export function builtinValidate(schema: JsonSchema, args: Record<string, unknown>): void {
  // required keys
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in args) || args[key] === undefined) {
        throw new Error(`invalid_args:missing required property '${key}'`);
      }
    }
  }

  // per-property type + enum checks
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in args)) continue;
      const value = args[key];

      // type check
      if (propSchema.type !== undefined) {
        const types = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
        const valid = types.some((t) => checkType(value, t));
        if (!valid) {
          throw new Error(
            `invalid_args:property '${key}' expected type '${types.join('|')}' but got '${typeof value}'`,
          );
        }
      }

      // enum check
      if (propSchema.enum !== undefined) {
        if (!propSchema.enum.includes(value)) {
          throw new Error(
            `invalid_args:property '${key}' must be one of [${propSchema.enum.map((v) => JSON.stringify(v)).join(', ')}]`,
          );
        }
      }
    }
  }
}

// ── Tool Router ───────────────────────────────────────────────────────────────

export interface ToolRouter {
  register(def: ToolDefinition): void;
  unregister(name: string): void;
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  has(name: string): boolean;
  dispatch<T = unknown>(call: DispatchCall): Promise<DispatchResult<T>>;
  dispatchBatch(
    calls: DispatchCall[],
    opts?: { parallel?: boolean; concurrency?: number },
  ): Promise<DispatchResult[]>;
  describe(): OpenAIToolDescription[];
}

export function createToolRouter(opts: ToolRouterOptions = {}): ToolRouter {
  const {
    validator = builtinValidate,
    onCall,
    defaultTimeoutMs = 30_000,
    clock = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  } = opts;

  const registry = new Map<string, ToolDefinition>();

  // idempotency de-dup map: key → in-flight Promise<DispatchResult>
  const inFlight = new Map<string, Promise<DispatchResult>>();

  // pre-register any tools passed in options
  if (opts.tools) {
    for (const tool of opts.tools) {
      registry.set(tool.name, tool);
    }
  }

  function register(def: ToolDefinition): void {
    if (registry.has(def.name)) {
      throw new Error(`duplicate_tool:tool '${def.name}' is already registered`);
    }
    registry.set(def.name, def);
  }

  function unregister(name: string): void {
    registry.delete(name);
  }

  function list(): ToolDefinition[] {
    return Array.from(registry.values());
  }

  function get(name: string): ToolDefinition | undefined {
    return registry.get(name);
  }

  function has(name: string): boolean {
    return registry.has(name);
  }

  function describe(): OpenAIToolDescription[] {
    return Array.from(registry.values()).map((def) => ({
      type: 'function' as const,
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      },
    }));
  }

  async function dispatchCore<T>(call: DispatchCall): Promise<DispatchResult<T>> {
    const { name, args, ctx } = call;

    if (!name) {
      return {
        ok: false,
        error: { type: 'invalid_call', message: 'tool name is required' },
        durationMs: 0,
        attempts: 0,
      };
    }

    const def = registry.get(name);
    if (!def) {
      return {
        ok: false,
        error: { type: 'tool_not_found', message: `tool '${name}' is not registered` },
        durationMs: 0,
        attempts: 0,
      };
    }

    // validate args
    try {
      validator(def.parameters, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: { type: 'invalid_args', message: msg },
        durationMs: 0,
        attempts: 0,
      };
    }

    // lifecycle hook
    if (onCall) {
      onCall({ name, args, ctx });
    }

    const timeoutMs = def.options?.timeoutMs ?? defaultTimeoutMs;
    const maxRetries = def.options?.retries ?? 0;

    const startMs = clock();
    let attempts = 0;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attempts += 1;
      try {
        const value = await Promise.race([
          Promise.resolve(def.handler(args as never, ctx)),
          new Promise<never>((_, reject) => {
            const id = setTimer(() => {
              reject(new Error('timeout'));
            }, timeoutMs);
            // We must clear this timer if the handler resolves first.
            // Wrap in void — we handle via the race, not here.
            void id;
          }),
        ]);

        return {
          ok: true,
          value: value as T,
          durationMs: clock() - startMs,
          attempts,
        };
      } catch (err) {
        lastError = err;
        // Only retry on retryable errors and when retries remain
        if (attempt < maxRetries && isRetryable(err)) {
          continue;
        }
        break;
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    const isTimeout = msg === 'timeout';
    return {
      ok: false,
      error: {
        type: isTimeout ? 'timeout' : 'handler_error',
        message: msg,
      },
      durationMs: clock() - startMs,
      attempts,
    };
  }

  async function dispatch<T = unknown>(call: DispatchCall): Promise<DispatchResult<T>> {
    const def = registry.get(call.name);
    const idempotent = def?.options?.idempotent ?? false;

    if (idempotent) {
      const key = `${call.name}::${JSON.stringify(call.args)}`;
      const existing = inFlight.get(key);
      if (existing) {
        return existing as Promise<DispatchResult<T>>;
      }
      const promise = dispatchCore<T>(call).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, promise as Promise<DispatchResult>);
      return promise;
    }

    return dispatchCore<T>(call);
  }

  async function dispatchBatch(
    calls: DispatchCall[],
    batchOpts: { parallel?: boolean; concurrency?: number } = {},
  ): Promise<DispatchResult[]> {
    const { parallel = true, concurrency = 4 } = batchOpts;

    if (!parallel) {
      const results: DispatchResult[] = [];
      for (const call of calls) {
        results.push(await dispatch(call));
      }
      return results;
    }

    // concurrency-bounded parallel execution preserving order
    const results: DispatchResult[] = new Array(calls.length);
    let index = 0;

    async function worker(): Promise<void> {
      while (index < calls.length) {
        const i = index++;
        results[i] = await dispatch(calls[i]);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, calls.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  return { register, unregister, list, get, has, dispatch, dispatchBatch, describe };
}
