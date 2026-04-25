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
 * Locates a `<tool_call ...>` opening tag (case-insensitive). The trailing
 * `\b` is intentionally omitted so that variants like `<tool_call=` and
 * `<tool_call>` both match — the scanner inspects the next char to decide.
 */
const TOOL_CALL_OPEN_TAG_RE = /<tool_call(?=[\s=>])/gi;
const TOOL_CALL_CLOSE_TAG = '</tool_call>';
/**
 * Scan-based locator that handles every tool_call shape we have seen in the
 * wild without relying on a single (and inevitably brittle) regex:
 *
 *   1. `<tool_call>{json}</tool_call>`       — canonical, used by Qwen/DeepSeek
 *   2. `<tool_call>{json}`                   — small models forget the closer
 *   3. `<tool_call={json}>`                  — ZhipuAI GLM (json embedded in tag)
 *   4. `<tool_call={json}>...</tool_call>`   — GLM with redundant closer
 *   5. `<tool_call>\nname\n{json}\n</tool_call>` — XML-ish (treated as JSON noise)
 *
 * Returns the spans in source order so that downstream code can both parse
 * and strip them.
 */
function locateToolCallSpans(text) {
    const spans = [];
    TOOL_CALL_OPEN_TAG_RE.lastIndex = 0;
    let m;
    while ((m = TOOL_CALL_OPEN_TAG_RE.exec(text)) !== null) {
        const tagStart = m.index;
        let i = m.index + m[0].length; // pointer just past "<tool_call"
        // Skip whitespace inside the tag.
        while (i < text.length && /\s/.test(text[i]))
            i++;
        let body = '';
        let spanEnd = i;
        if (text[i] === '=') {
            // GLM-style: <tool_call={json}> — JSON lives inside the tag.
            i++;
            while (i < text.length && /\s/.test(text[i]))
                i++;
            const json = extractFirstJsonObject(text.slice(i));
            if (!json) {
                // Malformed; advance past this opener so we don't loop forever.
                TOOL_CALL_OPEN_TAG_RE.lastIndex = i + 1;
                continue;
            }
            body = json;
            i += json.length;
            // Consume optional trailing chars up to and including `>`.
            while (i < text.length && text[i] !== '>')
                i++;
            if (text[i] === '>')
                i++;
            // Optional redundant `</tool_call>` immediately after.
            const tailRest = text.slice(i);
            const closeMatch = tailRest.match(/^\s*<\/tool_call>/i);
            if (closeMatch)
                i += closeMatch[0].length;
            spanEnd = i;
        }
        else if (text[i] === '>') {
            // Classic: <tool_call>...
            i++;
            const rest = text.slice(i);
            const closeIdx = rest.search(/<\/tool_call>/i);
            // Stop at the next opener too — protects against nested/concatenated calls.
            const nextOpenRe = /<tool_call(?=[\s=>])/i;
            const nextOpenMatch = rest.match(nextOpenRe);
            const nextOpenIdx = nextOpenMatch ? rest.indexOf(nextOpenMatch[0]) : -1;
            let endIdx;
            if (closeIdx >= 0 && (nextOpenIdx < 0 || closeIdx < nextOpenIdx)) {
                endIdx = closeIdx;
                body = rest.slice(0, endIdx);
                spanEnd = i + endIdx + TOOL_CALL_CLOSE_TAG.length;
            }
            else if (nextOpenIdx >= 0) {
                endIdx = nextOpenIdx;
                body = rest.slice(0, endIdx);
                spanEnd = i + endIdx;
            }
            else {
                body = rest;
                spanEnd = text.length;
            }
        }
        else {
            // Unrecognized char after `<tool_call` — skip this opener.
            TOOL_CALL_OPEN_TAG_RE.lastIndex = i + 1;
            continue;
        }
        spans.push({ tagStart, spanEnd, body });
        TOOL_CALL_OPEN_TAG_RE.lastIndex = spanEnd;
    }
    return spans;
}
function tryParseToolBody(body) {
    var _a, _b;
    // Trim accidental closing tag fragments and trailing junk.
    let raw = body.replace(/<\/tool_call>\s*$/i, '').trim();
    // Strip a leading `=` (some models emit `<tool_call> ={...}`).
    raw = raw.replace(/^=+\s*/, '');
    // Sometimes the model wraps the JSON in a ```json fence inside the tag.
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw)
        return null;
    // Try to grab just the first balanced JSON object if there's noise around.
    const objMatch = extractFirstJsonObject(raw);
    if (objMatch)
        raw = objMatch;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (_c) {
        const repaired = raw.replace(/(\w+):/g, '"$1":').replace(/'/g, '"');
        try {
            parsed = JSON.parse(repaired);
        }
        catch (err) {
            logger.warn('Failed to parse tool_call JSON', {
                rawPreview: raw.slice(0, 200),
                error: String(err),
            });
            return null;
        }
    }
    if (!parsed || typeof parsed !== 'object')
        return null;
    const obj = parsed;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const argsSrc = (_b = (_a = obj.args) !== null && _a !== void 0 ? _a : obj.arguments) !== null && _b !== void 0 ? _b : {};
    const args = argsSrc && typeof argsSrc === 'object'
        ? argsSrc
        : {};
    if (!name)
        return null;
    return { name, args };
}
/**
 * Parse zero or more tool calls from assistant text.
 * Robust against minor JSON noise (trailing commas, single quotes), against
 * models that forget to emit `</tool_call>`, and against GLM-style
 * `<tool_call={json}>` shapes where the JSON is embedded in the opening tag.
 */
export function parseToolCalls(text) {
    const calls = [];
    for (const span of locateToolCallSpans(text)) {
        const parsed = tryParseToolBody(span.body);
        if (parsed) {
            calls.push(Object.assign(Object.assign({}, parsed), { raw: text.slice(span.tagStart, span.spanEnd) }));
        }
    }
    return calls;
}
/**
 * Extract the first balanced `{...}` object from a string, ignoring text
 * after it. Returns null if no balanced object found.
 */
function extractFirstJsonObject(s) {
    const start = s.indexOf('{');
    if (start < 0)
        return null;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\') {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inStr = !inStr;
            continue;
        }
        if (inStr)
            continue;
        if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return s.slice(start, i + 1);
        }
    }
    return null;
}
/** Strip every `<tool_call ...>` block from text (all known shapes). */
export function stripToolCalls(text) {
    const spans = locateToolCallSpans(text);
    if (spans.length === 0) {
        // Even with no parsed spans, drop a stray unclosed `<tool_call` tail.
        return text.replace(/<tool_call[\s\S]*$/i, '').replace(/\n{3,}/g, '\n\n').trim();
    }
    let out = '';
    let cursor = 0;
    for (const span of spans) {
        out += text.slice(cursor, span.tagStart);
        cursor = span.spanEnd;
    }
    out += text.slice(cursor);
    return out.replace(/\n{3,}/g, '\n\n').trim();
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
        var _a, _b, _c;
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
        const { signal, approvalGate } = loopOpts;
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
            const text = yield chat(working, runOpts);
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
                var _a, _b;
                const toolMs = (_b = (_a = loopOpts.toolTimeoutsMs) === null || _a === void 0 ? void 0 : _a[call.name]) !== null && _b !== void 0 ? _b : defaultToolTimeoutMs;
                // Run through approval gate if one is configured
                if (approvalGate) {
                    const id = randomUUID();
                    const summary = renderSummary(call.name, call.args);
                    const decision = yield approvalGate({ id, toolName: call.name, summary, args: call.args });
                    if (decision !== 'approve') {
                        logger.info('Tool execution denied by approval gate', {
                            toolName: call.name,
                            decision,
                            sessionId: runOpts.sessionId,
                        });
                        return {
                            success: false,
                            data: {},
                            error: `User denied tool execution (${decision})`,
                        };
                    }
                }
                return raceToolExec(exec(call.name, call.args, toolCtx), call.name, toolMs, signal);
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
