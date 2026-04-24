import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SpanEvent {
  readonly name: string;
  readonly timeMs: number;
  readonly attrs?: Record<string, unknown>;
}

export interface SpanRecord {
  readonly id: string;
  readonly traceId: string;
  readonly parentId?: string;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly attrs: Record<string, unknown>;
  readonly events: readonly SpanEvent[];
  readonly status: 'ok' | 'error';
  readonly error?: string;
}

export interface Span {
  readonly id: string;
  readonly traceId: string;
  readonly parentId: string | undefined;
  readonly name: string;
  readonly attrs: Record<string, unknown>;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
  setAttr(key: string, value: unknown): void;
  setStatus(status: 'ok' | 'error', message?: string): void;
  end(): void;
}

export interface TracerOptions {
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Called once each time a span is finished. */
  emit?: (span: SpanRecord) => void;
  /** Ring-buffer capacity (default 200). */
  bufferSize?: number;
}

export interface Tracer {
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
  withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    attrs?: Record<string, unknown>,
  ): Promise<T>;
  getActiveSpan(): Span | undefined;
  recent(limit?: number): SpanRecord[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function newId(): string {
  return randomBytes(8).toString('hex');
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createTracer(opts: TracerOptions = {}): Tracer {
  const nowFn = opts.now ?? (() => Date.now());
  const emitFn = opts.emit;
  const bufferSize = opts.bufferSize ?? 200;

  const storage = new AsyncLocalStorage<Span>();
  const buffer: SpanRecord[] = [];

  function addToBuffer(record: SpanRecord): void {
    if (buffer.length >= bufferSize) buffer.shift();
    buffer.push(record);
  }

  function startSpan(name: string, attrs?: Record<string, unknown>): Span {
    const parent = storage.getStore();
    const id = newId();
    const traceId = parent ? parent.traceId : newId();
    const parentId = parent?.id;
    const startMs = nowFn();

    const spanAttrs: Record<string, unknown> = { ...(attrs ?? {}) };
    const events: SpanEvent[] = [];
    let status: 'ok' | 'error' = 'ok';
    let errorMsg: string | undefined;
    let ended = false;

    const span: Span = {
      get id() { return id; },
      get traceId() { return traceId; },
      get parentId() { return parentId; },
      get name() { return name; },
      get attrs() { return spanAttrs; },

      addEvent(eventName: string, eventAttrs?: Record<string, unknown>): void {
        events.push(
          eventAttrs !== undefined
            ? { name: eventName, timeMs: nowFn(), attrs: eventAttrs }
            : { name: eventName, timeMs: nowFn() },
        );
      },

      setAttr(key: string, value: unknown): void {
        spanAttrs[key] = value;
      },

      setStatus(s: 'ok' | 'error', msg?: string): void {
        status = s;
        if (msg !== undefined) errorMsg = msg;
      },

      end(): void {
        if (ended) return;
        ended = true;
        const endMs = nowFn();
        const record: SpanRecord = {
          id,
          traceId,
          ...(parentId !== undefined ? { parentId } : {}),
          name,
          startMs,
          endMs,
          durationMs: endMs - startMs,
          attrs: { ...spanAttrs },
          events: [...events],
          status,
          ...(errorMsg !== undefined ? { error: errorMsg } : {}),
        };
        addToBuffer(record);
        // Bug fix: swallow emit errors so a misbehaving callback cannot crash the caller.
        try { emitFn?.(record); } catch { /* intentionally swallowed */ }
      },
    };

    return span;
  }

  async function withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    attrs?: Record<string, unknown>,
  ): Promise<T> {
    const span = startSpan(name, attrs);
    return storage.run(span, async () => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (err) {
        span.setStatus('error', err instanceof Error ? err.message : String(err));
        span.end();
        throw err;
      }
    });
  }

  return {
    startSpan,
    withSpan,
    getActiveSpan(): Span | undefined {
      return storage.getStore();
    },
    recent(limit?: number): SpanRecord[] {
      const n = limit ?? bufferSize;
      return buffer.slice(-n);
    },
  };
}
