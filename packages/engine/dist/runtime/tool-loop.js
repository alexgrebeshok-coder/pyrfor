/**
 * Tool Calling Loop — provider-agnostic ReAct-style tool execution.
 *
 * Why prompt-based (not native function-calling)?
 * Our `AIProvider.chat()` returns `string` and doesn't expose structured
 * tool-call responses. To support tools across all 7 providers (Zhipu, ZAI,
 * OpenRouter, OpenAI, GigaChat, YandexGPT, Ollama) without overhauling each,
 * we describe tools in the system prompt and parse `<tool_call>...</tool_call>`
 * blocks from the assistant text.
 *
 * Loop:
 *   1. Inject tool instructions into messages
 *   2. Call provider → get assistant text
 *   3. Parse tool calls; if none → return final text
 *   4. Execute each tool call → append result as a user message
 *   5. Repeat until no tool calls or max iterations reached
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from 'node:crypto';
import { logger } from '../observability/logger.js';
import { parseToolCalls as parseToolCallsImpl, stripToolCalls as stripToolCallsImpl, } from './tool-call-parser.js';
const DEFAULT_MAX_ITER = 25;
const DEFAULT_MAX_RESULT_CHARS = 8000;
const DEFAULT_TOOL_TIMEOUT = 60000;
/** Hard safety cap — no call may exceed this iteration count regardless of caller value. */
export const SAFETY_HARD_CAP = 100;
// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------
const ANSI_ESCAPE_RE = 
// eslint-disable-next-line no-control-regex
/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-nqry=><]))/g;
function stripAnsi(text) {
    return text.replace(ANSI_ESCAPE_RE, '');
}
// ---------------------------------------------------------------------------
// Per-tool timeout + abort signal race
// ---------------------------------------------------------------------------
function raceToolExec(execPromise, toolName, timeoutMs, signal) {
    let timeoutId;
    let abortListener;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({
            success: false,
            data: {},
            error: `Tool ${toolName} timed out after ${timeoutMs}ms`,
        }), timeoutMs);
    });
    const races = [execPromise, timeoutPromise];
    if (signal) {
        const abortPromise = new Promise((resolve) => {
            if (signal.aborted) {
                resolve({ success: false, data: {}, error: `Tool ${toolName} aborted` });
                return;
            }
            abortListener = () => resolve({ success: false, data: {}, error: `Tool ${toolName} aborted` });
            signal.addEventListener('abort', abortListener, { once: true });
        });
        races.push(abortPromise);
    }
    return Promise.race(races).finally(() => {
        if (timeoutId !== undefined)
            clearTimeout(timeoutId);
        if (abortListener && signal)
            signal.removeEventListener('abort', abortListener);
    });
}
/**
 * Build the prompt fragment that teaches the model how to invoke tools.
 */
export function buildToolInstructions(tools) {
    if (tools.length === 0)
        return '';
    const lines = [
        '## Tool Calling',
        '',
        'You have access to the following tools. To call a tool, output exactly one or more',
        'lines in this format (one per tool call, anywhere in your reply):',
        '',
        '<tool_call>{"name": "<tool_name>", "args": {...}}</tool_call>',
        '',
        'Rules:',
        '- Use the JSON exactly as shown — no Markdown fences around the tag.',
        '- After your tool call(s), STOP and wait for results. The next user message',
        '  will contain the tool output.',
        '- When you have enough information, answer the user normally without any',
        '  <tool_call> tags. Plain text is the final answer.',
        '- Never invent tool results. Only use values returned in tool output messages.',
        '',
        'Available tools:',
    ];
    for (const tool of tools) {
        const params = JSON.stringify(tool.parameters);
        lines.push(`- **${tool.name}**: ${tool.description}`);
        lines.push(`  parameters: ${params}`);
    }
    return lines.join('\n');
}
/**
 * Parse zero or more tool calls from assistant text.
 * Delegates to the universal tool-call-parser module.
 * For backward compatibility, only the original `<tool_call>` tagged strategy
 * and arg-xml strategy are enabled. Other strategies can be enabled via ParseOptions
 * if the caller imports parseToolCalls directly from tool-call-parser.ts.
 */
export function parseToolCalls(text) {
    // Maintain backward compatibility: only enable strategies that the old parser supported.
    // The new parser module adds function-call-tag, openai-native, bare-object, and line-kv,
    // but these are disabled here to keep existing tests passing.
    return parseToolCallsImpl(text, {
        disableStrategies: [],
    });
}
/** Strip every tool-call block from text (all known shapes). */
export function stripToolCalls(text) {
    return stripToolCallsImpl(text);
}
/** Serialize a tool result for the LLM, stripping ANSI and truncating if too large. */
function formatToolResult(call, result, maxChars) {
    var _a, _b;
    const header = `[tool_result name=${call.name}${result.success ? '' : ' status=error'}]`;
    let body;
    try {
        // Strip ANSI escape sequences from string values before serialization (A5).
        const cleanData = result.success && typeof result.data === 'string' ? stripAnsi(result.data) : result.data;
        const cleanError = !result.success && typeof result.error === 'string' ? stripAnsi(result.error) : result.error;
        body = JSON.stringify(result.success ? { ok: true, data: cleanData } : { ok: false, error: cleanError }, null, 2);
    }
    catch (_c) {
        body = String((_b = (_a = result.data) !== null && _a !== void 0 ? _a : result.error) !== null && _b !== void 0 ? _b : '');
    }
    if (body.length > maxChars) {
        body = body.slice(0, maxChars) + `\n... [truncated ${body.length - maxChars} chars]`;
    }
    return `${header}\n${body}`;
}
// ---------------------------------------------------------------------------
// Approval summary renderer
// ---------------------------------------------------------------------------
/** Build a short human-readable description of a tool call for the approval prompt. */
function renderSummary(toolName, args) {
    var _a, _b, _c, _d;
    if (toolName === 'exec') {
        return `exec: ${String((_a = args.command) !== null && _a !== void 0 ? _a : '').slice(0, 200)}`;
    }
    if (toolName === 'process_spawn') {
        const cmd = String((_b = args.command) !== null && _b !== void 0 ? _b : '');
        const spawnArgs = Array.isArray(args.args) ? args.args.join(' ') : '';
        return `process_spawn: ${cmd}${spawnArgs ? ' ' + spawnArgs : ''}`.slice(0, 200);
    }
    if (toolName === 'browser') {
        return `browser: ${String((_d = (_c = args.url) !== null && _c !== void 0 ? _c : args.action) !== null && _d !== void 0 ? _d : 'action').slice(0, 200)}`;
    }
    return `${toolName}: ${JSON.stringify(args).slice(0, 200)}`;
}
/**
 * Run the tool calling loop.
 *
 * Strategy:
 *   - Inject tool instructions into the system message (or prepend a system msg).
 *   - On each turn, ask the model. If it emits tool calls, run them, append a
 *     user-role message with the results, and ask again.
 *   - Stop when the model returns text with no tool calls, or after maxIter.
 */
export function runToolLoop(messages_1, tools_1, chat_1, exec_1, toolCtx_1) {
    return __awaiter(this, arguments, void 0, function* (messages, tools, chat, exec, toolCtx, runOpts = {}, loopOpts = {}) {
        var _a, _b, _c, _d, _e;
        const requestedIter = (_a = loopOpts.maxIterations) !== null && _a !== void 0 ? _a : DEFAULT_MAX_ITER;
        if (requestedIter > SAFETY_HARD_CAP) {
            logger.warn('runToolLoop: maxIterations exceeds safetyHardCap; capping', {
                requested: requestedIter,
                cap: SAFETY_HARD_CAP,
                sessionId: runOpts.sessionId,
            });
        }
        const maxIter = Math.min(requestedIter, SAFETY_HARD_CAP);
        const maxChars = (_b = loopOpts.maxResultChars) !== null && _b !== void 0 ? _b : DEFAULT_MAX_RESULT_CHARS;
        const defaultToolTimeoutMs = (_c = loopOpts.toolTimeoutMs) !== null && _c !== void 0 ? _c : DEFAULT_TOOL_TIMEOUT;
        const { signal, approvalGate, onProgress, onToolAudit } = loopOpts;
        const instructions = buildToolInstructions(tools);
        // Augment the system prompt without mutating caller's array.
        const working = [...messages];
        if (instructions) {
            const sysIdx = working.findIndex((m) => m.role === 'system');
            if (sysIdx >= 0) {
                working[sysIdx] = {
                    role: 'system',
                    content: `${working[sysIdx].content}\n\n${instructions}`.trim(),
                };
            }
            else {
                working.unshift({ role: 'system', content: instructions });
            }
        }
        const assistantTurns = [];
        const toolCalls = [];
        let lastText = '';
        let truncated = false;
        let iter = 0;
        for (iter = 0; iter < maxIter; iter++) {
            // Check abort before each model call.
            if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                return {
                    finalText: '',
                    assistantTurns,
                    toolCalls,
                    truncated: false,
                    iterations: iter,
                    stopped: true,
                    reason: 'aborted',
                };
            }
            const llmStartedAt = Date.now();
            onProgress === null || onProgress === void 0 ? void 0 : onProgress({ kind: 'llm-start', model: (_d = runOpts.model) !== null && _d !== void 0 ? _d : '' });
            const text = yield chat(working, runOpts);
            onProgress === null || onProgress === void 0 ? void 0 : onProgress({ kind: 'llm-end', model: (_e = runOpts.model) !== null && _e !== void 0 ? _e : '', ms: Date.now() - llmStartedAt });
            lastText = text;
            assistantTurns.push(text);
            const calls = parseToolCalls(text);
            if (calls.length === 0) {
                return {
                    finalText: stripToolCalls(text),
                    assistantTurns,
                    toolCalls,
                    truncated: false,
                    iterations: iter + 1,
                };
            }
            // Append assistant turn (with tool blocks intact, model will see history)
            working.push({ role: 'assistant', content: text });
            // Execute tool calls concurrently where safe (independent calls, no shared state)
            const resultParts = [];
            // Log all tool calls upfront
            for (const call of calls) {
                logger.info('Tool call', {
                    name: call.name,
                    sessionId: runOpts.sessionId,
                    argsPreview: JSON.stringify(call.args).slice(0, 200),
                });
            }
            // Execute calls concurrently using Promise.allSettled
            const execPromises = calls.map((call) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d;
                const requestId = randomUUID();
                const toolMs = (_b = (_a = loopOpts.toolTimeoutsMs) === null || _a === void 0 ? void 0 : _a[call.name]) !== null && _b !== void 0 ? _b : defaultToolTimeoutMs;
                const summary = renderSummary(call.name, call.args);
                // Run through approval gate if one is configured
                if (approvalGate) {
                    const decision = yield approvalGate({ id: requestId, toolName: call.name, summary, args: call.args });
                    if (decision !== 'approve') {
                        logger.info('Tool execution denied by approval gate', {
                            toolName: call.name,
                            decision,
                            sessionId: runOpts.sessionId,
                        });
                        onToolAudit === null || onToolAudit === void 0 ? void 0 : onToolAudit({
                            requestId,
                            toolCallId: requestId,
                            toolName: call.name,
                            summary,
                            args: call.args,
                            decision,
                            sessionId: runOpts.sessionId,
                            error: `User denied tool execution (${decision})`,
                            undo: { supported: false },
                        });
                        return {
                            success: false,
                            data: {},
                            error: `User denied tool execution (${decision})`,
                        };
                    }
                }
                onProgress === null || onProgress === void 0 ? void 0 : onProgress({ kind: 'tool-start', name: call.name, summary });
                const startedAt = Date.now();
                const result = yield raceToolExec(exec(call.name, call.args, toolCtx), call.name, toolMs, signal);
                onProgress === null || onProgress === void 0 ? void 0 : onProgress({ kind: 'tool-end', name: call.name, ok: result.success, ms: Date.now() - startedAt });
                onToolAudit === null || onToolAudit === void 0 ? void 0 : onToolAudit({
                    requestId,
                    toolCallId: requestId,
                    toolName: call.name,
                    summary,
                    args: call.args,
                    decision: 'approve',
                    sessionId: runOpts.sessionId,
                    resultSummary: result.success
                        ? JSON.stringify((_c = result.data) !== null && _c !== void 0 ? _c : {}).slice(0, 300)
                        : undefined,
                    error: result.success ? undefined : String((_d = result.error) !== null && _d !== void 0 ? _d : 'Tool failed'),
                    undo: { supported: false },
                });
                return result;
            }));
            const results = yield Promise.allSettled(execPromises);
            // Map results back in order and accumulate
            for (let i = 0; i < calls.length; i++) {
                const call = calls[i];
                let result;
                const settled = results[i];
                if (settled.status === 'fulfilled') {
                    result = settled.value;
                }
                else {
                    const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
                    result = { success: false, data: {}, error: `Tool threw: ${msg}` };
                }
                toolCalls.push({ call, result });
                resultParts.push(formatToolResult(call, result, maxChars));
                // Check abort after processing results.
                if (signal === null || signal === void 0 ? void 0 : signal.aborted)
                    break;
            }
            // Check abort after tool execution block before next model call.
            if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                return {
                    finalText: '',
                    assistantTurns,
                    toolCalls,
                    truncated: false,
                    iterations: iter + 1,
                    stopped: true,
                    reason: 'aborted',
                };
            }
            working.push({
                role: 'user',
                content: resultParts.join('\n\n'),
            });
        }
        // Hit iteration cap — return whatever we last got, stripped.
        truncated = true;
        logger.warn('Tool loop hit max iterations', {
            iterations: iter,
            sessionId: runOpts.sessionId,
        });
        const cleaned = stripToolCalls(lastText);
        const finalText = cleaned ||
            `⚠️ Достиг лимита итераций tool-вызовов (${maxIter}). Последний вывод модели не содержал финального ответа.`;
        return {
            finalText,
            assistantTurns,
            toolCalls,
            truncated,
            iterations: iter,
        };
    });
}
