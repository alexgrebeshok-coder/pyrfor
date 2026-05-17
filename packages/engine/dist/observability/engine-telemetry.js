var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createTracer } from './tracer.js';
import { createOtelSpanBridge, initOtel, shutdownOtel } from './otel/index.js';
import { GEN_AI_OPERATION_NAME, GEN_AI_REQUEST_MODEL, GEN_AI_TOOL_NAME, GEN_AI_USAGE_COST, GEN_AI_USAGE_INPUT_TOKENS, GEN_AI_USAGE_OUTPUT_TOKENS, GEN_AI_USAGE_TOTAL_TOKENS, genAiLifecycleAttrs, } from './otel/genai-attrs.js';
let tracer = createTracer();
let otelEnabled = false;
export function configureEngineTelemetry(otel) {
    void shutdownOtel();
    otelEnabled = Boolean(otel === null || otel === void 0 ? void 0 : otel.enabled);
    if (otelEnabled) {
        const shutdownHook = initOtel(otel);
        const bridge = createOtelSpanBridge();
        tracer = createTracer({ emit: (record) => bridge.emit(record) });
        return () => __awaiter(this, void 0, void 0, function* () {
            yield shutdownHook();
            yield shutdownOtel();
            tracer = createTracer();
            otelEnabled = false;
        });
    }
    tracer = createTracer();
    return () => __awaiter(this, void 0, void 0, function* () { });
}
export function getEngineTracer() {
    return tracer;
}
export function isEngineOtelEnabled() {
    return otelEnabled;
}
export function traceLifecycleStep(step, runId, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        return tracer.withSpan(`lifecycle.${step}`, (span) => __awaiter(this, void 0, void 0, function* () {
            span.setAttr('run.id', runId !== null && runId !== void 0 ? runId : 'unknown');
            Object.entries(genAiLifecycleAttrs(step)).forEach(([k, v]) => span.setAttr(k, v));
            return fn();
        }), genAiLifecycleAttrs(step));
    });
}
export function traceLlmChat(model, fn, recordUsage) {
    return __awaiter(this, void 0, void 0, function* () {
        return tracer.withSpan('llm.chat', (span) => __awaiter(this, void 0, void 0, function* () {
            span.setAttr(GEN_AI_OPERATION_NAME, 'chat');
            span.setAttr(GEN_AI_REQUEST_MODEL, model !== null && model !== void 0 ? model : 'unknown');
            const result = yield fn();
            const usage = recordUsage === null || recordUsage === void 0 ? void 0 : recordUsage(result);
            if ((usage === null || usage === void 0 ? void 0 : usage.inputTokens) !== undefined) {
                span.setAttr(GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens);
            }
            if ((usage === null || usage === void 0 ? void 0 : usage.outputTokens) !== undefined) {
                span.setAttr(GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens);
            }
            if ((usage === null || usage === void 0 ? void 0 : usage.inputTokens) !== undefined && (usage === null || usage === void 0 ? void 0 : usage.outputTokens) !== undefined) {
                span.setAttr(GEN_AI_USAGE_TOTAL_TOKENS, usage.inputTokens + usage.outputTokens);
            }
            if ((usage === null || usage === void 0 ? void 0 : usage.costUsd) !== undefined) {
                span.setAttr(GEN_AI_USAGE_COST, usage.costUsd);
            }
            return result;
        }), { [GEN_AI_OPERATION_NAME]: 'chat', [GEN_AI_REQUEST_MODEL]: model !== null && model !== void 0 ? model : 'unknown' });
    });
}
export function traceToolCall(toolName, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        return tracer.withSpan('tool.call', (span) => __awaiter(this, void 0, void 0, function* () {
            span.setAttr(GEN_AI_OPERATION_NAME, 'execute_tool');
            span.setAttr(GEN_AI_TOOL_NAME, toolName);
            return fn();
        }), { [GEN_AI_OPERATION_NAME]: 'execute_tool', [GEN_AI_TOOL_NAME]: toolName });
    });
}
