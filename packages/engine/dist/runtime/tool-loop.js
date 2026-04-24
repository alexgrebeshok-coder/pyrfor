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
import { logger } from '../observability/logger';
const DEFAULT_MAX_ITER = 5;
const DEFAULT_MAX_RESULT_CHARS = 8000;
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
const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
// Lenient fallback: an opening <tool_call> with no closing tag (small models
// often forget the closer). Match from the tag to the next <tool_call> or EOS.
const TOOL_CALL_OPEN_RE = /<tool_call>\s*([\s\S]*?)(?=<tool_call>|$)/gi;
/**
 * Parse zero or more tool calls from assistant text.
 * Robust against minor JSON noise (trailing commas, single quotes) AND
 * against models that forget to emit `</tool_call>`.
 */
export function parseToolCalls(text) {
    const calls = [];
    const seenSpans = new Set();
    const tryParseBody = (body) => {
        var _a, _b;
        // Trim accidental closing tag fragments and trailing junk.
        let raw = body.replace(/<\/tool_call>\s*$/i, '').trim();
        // Sometimes the model wraps the JSON in a ```json fence inside the tag.
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        if (!raw)
            return null;
        // Try to grab just the first balanced JSON object if there's noise after.
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
    };
    // Pass 1: well-formed <tool_call>...</tool_call>
    let match;
    TOOL_CALL_RE.lastIndex = 0;
    while ((match = TOOL_CALL_RE.exec(text)) !== null) {
        const spanKey = `closed:${match.index}`;
        if (seenSpans.has(spanKey))
            continue;
        seenSpans.add(spanKey);
        const parsed = tryParseBody(match[1]);
        if (parsed)
            calls.push(Object.assign(Object.assign({}, parsed), { raw: match[0] }));
    }
    // Pass 2: lenient — only if pass 1 produced nothing.
    if (calls.length === 0) {
        TOOL_CALL_OPEN_RE.lastIndex = 0;
        while ((match = TOOL_CALL_OPEN_RE.exec(text)) !== null) {
            const parsed = tryParseBody(match[1]);
            if (parsed)
                calls.push(Object.assign(Object.assign({}, parsed), { raw: match[0] }));
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
/** Strip all `<tool_call>...</tool_call>` blocks from text (closed and unclosed). */
export function stripToolCalls(text) {
    return text
        .replace(TOOL_CALL_RE, '')
        .replace(/<tool_call>[\s\S]*$/i, '') // unclosed trailing block
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** Serialize a tool result for the LLM, truncating if too large. */
function formatToolResult(call, result, maxChars) {
    var _a, _b;
    const header = `[tool_result name=${call.name}${result.success ? '' : ' status=error'}]`;
    let body;
    try {
        body = JSON.stringify(result.success ? { ok: true, data: result.data } : { ok: false, error: result.error }, null, 2);
    }
    catch (_c) {
        body = String((_b = (_a = result.data) !== null && _a !== void 0 ? _a : result.error) !== null && _b !== void 0 ? _b : '');
    }
    if (body.length > maxChars) {
        body = body.slice(0, maxChars) + `\n... [truncated ${body.length - maxChars} chars]`;
    }
    return `${header}\n${body}`;
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
        var _a, _b;
        const maxIter = (_a = loopOpts.maxIterations) !== null && _a !== void 0 ? _a : DEFAULT_MAX_ITER;
        const maxChars = (_b = loopOpts.maxResultChars) !== null && _b !== void 0 ? _b : DEFAULT_MAX_RESULT_CHARS;
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
            // Execute each tool call, accumulate results in one user message
            const resultParts = [];
            for (const call of calls) {
                logger.info('Tool call', {
                    name: call.name,
                    sessionId: runOpts.sessionId,
                    argsPreview: JSON.stringify(call.args).slice(0, 200),
                });
                let result;
                try {
                    result = yield exec(call.name, call.args, toolCtx);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    result = { success: false, data: {}, error: `Tool threw: ${msg}` };
                }
                toolCalls.push({ call, result });
                resultParts.push(formatToolResult(call, result, maxChars));
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
