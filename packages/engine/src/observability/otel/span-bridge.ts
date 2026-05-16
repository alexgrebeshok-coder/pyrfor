import {
  context,
  trace,
  SpanStatusCode,
  type Span,
  type SpanContext,
  TraceFlags,
} from '@opentelemetry/api';
import type { SpanRecord } from '../tracer.js';

function padHex(value: string, length: number): string {
  return value.padStart(length, '0').slice(0, length);
}

function toTraceId(id: string): string {
  return padHex(id.replace(/[^a-f0-9]/gi, ''), 32);
}

function toSpanId(id: string): string {
  return padHex(id.replace(/[^a-f0-9]/gi, ''), 16);
}

function attrValue(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

/** Bridges in-memory {@link SpanRecord} emissions to the global OpenTelemetry tracer. */
export function createOtelSpanBridge(tracerName = 'pyrfor-engine') {
  const tracer = trace.getTracer(tracerName);
  const spanContextByRecordId = new Map<string, SpanContext>();

  return {
    emit(record: SpanRecord): void {
      let parentContext = context.active();
      if (record.parentId) {
        const storedParent = spanContextByRecordId.get(record.parentId);
        parentContext = storedParent
          ? trace.setSpanContext(context.active(), storedParent)
          : trace.setSpanContext(context.active(), {
              traceId: toTraceId(record.traceId),
              spanId: toSpanId(record.parentId),
              isRemote: true,
              traceFlags: TraceFlags.SAMPLED,
            });
      }

      const span: Span = tracer.startSpan(
        record.name,
        { startTime: record.startMs },
        parentContext,
      );
      spanContextByRecordId.set(record.id, span.spanContext());

      for (const [key, value] of Object.entries(record.attrs)) {
        span.setAttribute(key, attrValue(value));
      }
      for (const event of record.events) {
        span.addEvent(event.name, event.attrs as Record<string, string | number | boolean> | undefined, event.timeMs);
      }
      if (record.status === 'error') {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: record.error ?? 'error',
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end(record.endMs);
    },
  };
}
