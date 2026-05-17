import { type Tracer } from './tracer.js';
import { type OtelConfig } from './otel/index.js';
import { type GenAiAgentStep } from './otel/genai-attrs.js';
export declare function configureEngineTelemetry(otel?: OtelConfig): () => Promise<void>;
export declare function getEngineTracer(): Tracer;
export declare function isEngineOtelEnabled(): boolean;
export declare function traceLifecycleStep<T>(step: GenAiAgentStep, runId: string | undefined, fn: () => Promise<T> | T): Promise<T>;
export declare function traceLlmChat<T>(model: string | undefined, fn: () => Promise<T>, recordUsage?: (result: T) => {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
}): Promise<T>;
export declare function traceToolCall<T>(toolName: string, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=engine-telemetry.d.ts.map