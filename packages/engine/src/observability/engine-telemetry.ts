import { createTracer, type Tracer } from './tracer.js';
import { createOtelSpanBridge, initOtel, shutdownOtel, type OtelConfig } from './otel/index.js';
import {
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_TOOL_NAME,
  GEN_AI_USAGE_COST,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_TOTAL_TOKENS,
  genAiLifecycleAttrs,
  type GenAiAgentStep,
} from './otel/genai-attrs.js';

let tracer: Tracer = createTracer();
let otelEnabled = false;

export function configureEngineTelemetry(otel?: OtelConfig): () => Promise<void> {
  void shutdownOtel();
  otelEnabled = Boolean(otel?.enabled);
  if (otelEnabled) {
    const shutdownHook = initOtel(otel!);
    const bridge = createOtelSpanBridge();
    tracer = createTracer({ emit: (record) => bridge.emit(record) });
    return async () => {
      await shutdownHook();
      await shutdownOtel();
      tracer = createTracer();
      otelEnabled = false;
    };
  }
  tracer = createTracer();
  return async () => {};
}

export function getEngineTracer(): Tracer {
  return tracer;
}

export function isEngineOtelEnabled(): boolean {
  return otelEnabled;
}

export async function traceLifecycleStep<T>(
  step: GenAiAgentStep,
  runId: string | undefined,
  fn: () => Promise<T> | T,
): Promise<T> {
  return tracer.withSpan(
    `lifecycle.${step}`,
    async (span) => {
      span.setAttr('run.id', runId ?? 'unknown');
      Object.entries(genAiLifecycleAttrs(step)).forEach(([k, v]) => span.setAttr(k, v));
      return fn();
    },
    genAiLifecycleAttrs(step),
  );
}

export async function traceLlmChat<T>(
  model: string | undefined,
  fn: () => Promise<T>,
  recordUsage?: (result: T) => {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  },
): Promise<T> {
  return tracer.withSpan(
    'llm.chat',
    async (span) => {
      span.setAttr(GEN_AI_OPERATION_NAME, 'chat');
      span.setAttr(GEN_AI_REQUEST_MODEL, model ?? 'unknown');
      const result = await fn();
      const usage = recordUsage?.(result);
      if (usage?.inputTokens !== undefined) {
        span.setAttr(GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens);
      }
      if (usage?.outputTokens !== undefined) {
        span.setAttr(GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens);
      }
      if (usage?.inputTokens !== undefined && usage?.outputTokens !== undefined) {
        span.setAttr(GEN_AI_USAGE_TOTAL_TOKENS, usage.inputTokens + usage.outputTokens);
      }
      if (usage?.costUsd !== undefined) {
        span.setAttr(GEN_AI_USAGE_COST, usage.costUsd);
      }
      return result;
    },
    { [GEN_AI_OPERATION_NAME]: 'chat', [GEN_AI_REQUEST_MODEL]: model ?? 'unknown' },
  );
}

export async function traceToolCall<T>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.withSpan(
    'tool.call',
    async (span) => {
      span.setAttr(GEN_AI_OPERATION_NAME, 'execute_tool');
      span.setAttr(GEN_AI_TOOL_NAME, toolName);
      return fn();
    },
    { [GEN_AI_OPERATION_NAME]: 'execute_tool', [GEN_AI_TOOL_NAME]: toolName },
  );
}
