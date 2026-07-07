import type { SpanRecord } from '../tracer.js';
/** Bridges in-memory {@link SpanRecord} emissions to the global OpenTelemetry tracer. */
export declare function createOtelSpanBridge(tracerName?: string): {
    emit(record: SpanRecord): void;
};
//# sourceMappingURL=span-bridge.d.ts.map