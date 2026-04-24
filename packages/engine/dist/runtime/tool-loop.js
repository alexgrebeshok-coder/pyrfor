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
