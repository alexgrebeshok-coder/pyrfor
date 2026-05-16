// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createTracer, type SpanRecord } from '../tracer.js';
import { createOtelSpanBridge } from './span-bridge.js';
import {
  GEN_AI_AGENT_STEP,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_TOOL_NAME,
  GEN_AI_USAGE_INPUT_TOKENS,
  genAiLifecycleAttrs,
} from './genai-attrs.js';

describe('OtelSpanBridge', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('maps tracer spans to OTel with GenAI lifecycle attributes', async () => {
    const bridge = createOtelSpanBridge('test-tracer');
    const tracer = createTracer({ emit: (record) => bridge.emit(record) });

    await tracer.withSpan(
      'lifecycle.plan',
      async (span) => {
        Object.entries(genAiLifecycleAttrs('plan')).forEach(([k, v]) => span.setAttr(k, v));
      },
      genAiLifecycleAttrs('plan'),
    );

    await provider.forceFlush();
    const finished = exporter.getFinishedSpans();
    expect(finished).toHaveLength(1);
    expect(finished[0].name).toBe('lifecycle.plan');
    expect(finished[0].attributes[GEN_AI_AGENT_STEP]).toBe('plan');
  });

  it('createTracer preserves parent links in emitted records', async () => {
    const records: SpanRecord[] = [];
    const bridge = createOtelSpanBridge('test-tracer');
    const tracer = createTracer({ emit: (record) => records.push(record) });

    await tracer.withSpan('parent', async () => {
      await tracer.withSpan('child', async () => {});
    });

    expect(records).toHaveLength(2);
    const parent = records.find((record) => record.name === 'parent');
    const child = records.find((record) => record.name === 'child');
    expect(parent).toBeDefined();
    expect(child?.parentId).toBe(parent?.id);
    expect(parent?.traceId).toBe(child?.traceId);
  });

  it('records LLM and tool semantic attributes', async () => {
    const otelTracer = provider.getTracer('test-tracer');
    const span = otelTracer.startSpan('llm.chat');
    span.setAttribute(GEN_AI_REQUEST_MODEL, 'gpt-test');
    span.setAttribute(GEN_AI_USAGE_INPUT_TOKENS, 12);
    span.setAttribute(GEN_AI_TOOL_NAME, 'exec');
    span.end();
    await provider.forceFlush();

    const finished = exporter.getFinishedSpans();
    expect(finished[0].attributes[GEN_AI_REQUEST_MODEL]).toBe('gpt-test');
    expect(finished[0].attributes[GEN_AI_USAGE_INPUT_TOKENS]).toBe(12);
    expect(finished[0].attributes[GEN_AI_TOOL_NAME]).toBe('exec');
  });
});
