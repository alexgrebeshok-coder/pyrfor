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
    withSpan<T>(name: string, fn: (span: Span) => Promise<T> | T, attrs?: Record<string, unknown>): Promise<T>;
    getActiveSpan(): Span | undefined;
    recent(limit?: number): SpanRecord[];
}
export declare function createTracer(opts?: TracerOptions): Tracer;
//# sourceMappingURL=tracer.d.ts.map