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

import type { Message } from '../ai/providers/base';
import { logger } from '../observability/logger';
import type { ToolDefinition, ToolContext, ToolResult } from './tools';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

export interface ToolLoopOptions {
  maxIterations?: number;
  /** Soft cap on serialized tool result size before truncation. */
  maxResultChars?: number;
  /** Per-tool-call timeout in ms (default: 60_000). */
  toolTimeoutMs?: number;
  /** Per-tool-name timeout overrides; takes priority over toolTimeoutMs. */
  toolTimeoutsMs?: Record<string, number>;
  /** AbortSignal to cancel the loop externally between iterations or during tool calls. */
  signal?: AbortSignal;
}

export interface ToolLoopRunOptions {
  provider?: string;
  model?: string;
  sessionId?: string;
}

export type ChatFn = (
  messages: Message[],
  options?: ToolLoopRunOptions
) => Promise<string>;

export type ToolExecFn = (
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolContext
) => Promise<ToolResult>;

export interface ToolLoopResult {
  /** Final assistant text with tool blocks stripped. */
  finalText: string;
  /** All assistant turns (with tool blocks) appended during the loop. */
  assistantTurns: string[];
  /** Tool calls executed, in order. */
  toolCalls: Array<{ call: ToolCall; result: ToolResult }>;
  /** True if we hit the iteration cap without a clean final text. */
  truncated: boolean;
  iterations: number;
  /** True if the loop was stopped early by an AbortSignal. */
  stopped?: boolean;
  /** Human-readable reason for an early stop (e.g., 'aborted'). */
  reason?: string;
}

const DEFAULT_MAX_ITER = 25;
const DEFAULT_MAX_RESULT_CHARS = 8000;
const DEFAULT_TOOL_TIMEOUT = 60_000;
/** Hard safety cap — no call may exceed this iteration count regardless of caller value. */
export const SAFETY_HARD_CAP = 100;

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

const ANSI_ESCAPE_RE =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-nqry=><]))/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

// ---------------------------------------------------------------------------
// Per-tool timeout + abort signal race
// ---------------------------------------------------------------------------

function raceToolExec(
  execPromise: Promise<ToolResult>,
  toolName: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  const timeoutPromise = new Promise<ToolResult>((resolve) => {
    timeoutId = setTimeout(
      () =>
        resolve({
          success: false,
          data: {},
          error: `Tool ${toolName} timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
  });

  const races: Promise<ToolResult>[] = [execPromise, timeoutPromise];

  if (signal) {
    const abortPromise = new Promise<ToolResult>((resolve) => {
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
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortListener && signal) signal.removeEventListener('abort', abortListener);
  });
}

/**
 * Build the prompt fragment that teaches the model how to invoke tools.
 */
export function buildToolInstructions(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';
  const lines: string[] = [
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

interface ParsedTagSpan {
  /** Index in source where the `<tool_call` started. */
  tagStart: number;
  /** Index in source one past the end of this tool call (incl. closer if present). */
  spanEnd: number;
  /** Raw body string to feed JSON parsing. */
  body: string;
}

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
function locateToolCallSpans(text: string): ParsedTagSpan[] {
  const spans: ParsedTagSpan[] = [];
  TOOL_CALL_OPEN_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_CALL_OPEN_TAG_RE.exec(text)) !== null) {
    const tagStart = m.index;
    let i = m.index + m[0].length; // pointer just past "<tool_call"

    // Skip whitespace inside the tag.
    while (i < text.length && /\s/.test(text[i])) i++;

    let body = '';
    let spanEnd = i;

    if (text[i] === '=') {
      // GLM-style: <tool_call={json}> — JSON lives inside the tag.
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      const json = extractFirstJsonObject(text.slice(i));
      if (!json) {
        // Malformed; advance past this opener so we don't loop forever.
        TOOL_CALL_OPEN_TAG_RE.lastIndex = i + 1;
        continue;
      }
      body = json;
      i += json.length;
      // Consume optional trailing chars up to and including `>`.
      while (i < text.length && text[i] !== '>') i++;
      if (text[i] === '>') i++;
      // Optional redundant `</tool_call>` immediately after.
      const tailRest = text.slice(i);
      const closeMatch = tailRest.match(/^\s*<\/tool_call>/i);
      if (closeMatch) i += closeMatch[0].length;
      spanEnd = i;
    } else if (text[i] === '>') {
      // Classic: <tool_call>...
      i++;
      const rest = text.slice(i);
      const closeIdx = rest.search(/<\/tool_call>/i);
      // Stop at the next opener too — protects against nested/concatenated calls.
      const nextOpenRe = /<tool_call(?=[\s=>])/i;
      const nextOpenMatch = rest.match(nextOpenRe);
      const nextOpenIdx = nextOpenMatch ? rest.indexOf(nextOpenMatch[0]) : -1;

      let endIdx: number;
      if (closeIdx >= 0 && (nextOpenIdx < 0 || closeIdx < nextOpenIdx)) {
        endIdx = closeIdx;
        body = rest.slice(0, endIdx);
        spanEnd = i + endIdx + TOOL_CALL_CLOSE_TAG.length;
      } else if (nextOpenIdx >= 0) {
        endIdx = nextOpenIdx;
        body = rest.slice(0, endIdx);
        spanEnd = i + endIdx;
      } else {
        body = rest;
        spanEnd = text.length;
      }
    } else {
      // Unrecognized char after `<tool_call` — skip this opener.
      TOOL_CALL_OPEN_TAG_RE.lastIndex = i + 1;
      continue;
    }

    spans.push({ tagStart, spanEnd, body });
    TOOL_CALL_OPEN_TAG_RE.lastIndex = spanEnd;
  }
  return spans;
}

function tryParseToolBody(body: string): { name: string; args: Record<string, unknown> } | null {
  // Trim accidental closing tag fragments and trailing junk.
  let raw = body.replace(/<\/tool_call>\s*$/i, '').trim();
  // Strip a leading `=` (some models emit `<tool_call> ={...}`).
  raw = raw.replace(/^=+\s*/, '');
  // Sometimes the model wraps the JSON in a ```json fence inside the tag.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!raw) return null;

  // Try to grab just the first balanced JSON object if there's noise around.
  const objMatch = extractFirstJsonObject(raw);
  if (objMatch) raw = objMatch;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const repaired = raw.replace(/(\w+):/g, '"$1":').replace(/'/g, '"');
    try {
      parsed = JSON.parse(repaired);
    } catch (err) {
      logger.warn('Failed to parse tool_call JSON', {
        rawPreview: raw.slice(0, 200),
        error: String(err),
      });
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { name?: unknown; args?: unknown; arguments?: unknown };
  const name = typeof obj.name === 'string' ? obj.name : '';
  const argsSrc = obj.args ?? obj.arguments ?? {};
  const args =
    argsSrc && typeof argsSrc === 'object'
      ? (argsSrc as Record<string, unknown>)
      : {};
  if (!name) return null;
  return { name, args };
}

/**
 * Parse zero or more tool calls from assistant text.
 * Robust against minor JSON noise (trailing commas, single quotes), against
 * models that forget to emit `</tool_call>`, and against GLM-style
 * `<tool_call={json}>` shapes where the JSON is embedded in the opening tag.
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const span of locateToolCallSpans(text)) {
    const parsed = tryParseToolBody(span.body);
    if (parsed) {
      calls.push({ ...parsed, raw: text.slice(span.tagStart, span.spanEnd) });
    }
  }
  return calls;
}

/**
 * Extract the first balanced `{...}` object from a string, ignoring text
 * after it. Returns null if no balanced object found.
 */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Strip every `<tool_call ...>` block from text (all known shapes). */
export function stripToolCalls(text: string): string {
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
function formatToolResult(call: ToolCall, result: ToolResult, maxChars: number): string {
  const header = `[tool_result name=${call.name}${result.success ? '' : ' status=error'}]`;
  let body: string;
  try {
    // Strip ANSI escape sequences from string values before serialization (A5).
    const cleanData =
      result.success && typeof result.data === 'string' ? stripAnsi(result.data) : result.data;
    const cleanError =
      !result.success && typeof result.error === 'string' ? stripAnsi(result.error) : result.error;
    body = JSON.stringify(
      result.success ? { ok: true, data: cleanData } : { ok: false, error: cleanError },
      null,
      2
    );
  } catch {
    body = String(result.data ?? result.error ?? '');
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
export async function runToolLoop(
  messages: Message[],
  tools: ToolDefinition[],
  chat: ChatFn,
  exec: ToolExecFn,
  toolCtx: ToolContext | undefined,
  runOpts: ToolLoopRunOptions = {},
  loopOpts: ToolLoopOptions = {}
): Promise<ToolLoopResult> {
  const requestedIter = loopOpts.maxIterations ?? DEFAULT_MAX_ITER;
  if (requestedIter > SAFETY_HARD_CAP) {
    logger.warn('runToolLoop: maxIterations exceeds safetyHardCap; capping', {
      requested: requestedIter,
      cap: SAFETY_HARD_CAP,
      sessionId: runOpts.sessionId,
    });
  }
  const maxIter = Math.min(requestedIter, SAFETY_HARD_CAP);
  const maxChars = loopOpts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  const defaultToolTimeoutMs = loopOpts.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT;
  const { signal } = loopOpts;

  const instructions = buildToolInstructions(tools);
  // Augment the system prompt without mutating caller's array.
  const working: Message[] = [...messages];
  if (instructions) {
    const sysIdx = working.findIndex((m) => m.role === 'system');
    if (sysIdx >= 0) {
      working[sysIdx] = {
        role: 'system',
        content: `${working[sysIdx].content}\n\n${instructions}`.trim(),
      };
    } else {
      working.unshift({ role: 'system', content: instructions });
    }
  }

  const assistantTurns: string[] = [];
  const toolCalls: Array<{ call: ToolCall; result: ToolResult }> = [];
  let lastText = '';
  let truncated = false;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    // Check abort before each model call.
    if (signal?.aborted) {
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

    const text = await chat(working, runOpts);
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
    const resultParts: string[] = [];
    
    // Log all tool calls upfront
    for (const call of calls) {
      logger.info('Tool call', {
        name: call.name,
        sessionId: runOpts.sessionId,
        argsPreview: JSON.stringify(call.args).slice(0, 200),
      });
    }

    // Execute calls concurrently using Promise.allSettled
    const execPromises = calls.map((call) => {
      const toolMs = loopOpts.toolTimeoutsMs?.[call.name] ?? defaultToolTimeoutMs;
      return raceToolExec(exec(call.name, call.args, toolCtx), call.name, toolMs, signal);
    });

    const results = await Promise.allSettled(execPromises);

    // Map results back in order and accumulate
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      let result: ToolResult;
      const settled = results[i];

      if (settled.status === 'fulfilled') {
        result = settled.value;
      } else {
        const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        result = { success: false, data: {}, error: `Tool threw: ${msg}` };
      }

      toolCalls.push({ call, result });
      resultParts.push(formatToolResult(call, result, maxChars));

      // Check abort after processing results.
      if (signal?.aborted) break;
    }

    // Check abort after tool execution block before next model call.
    if (signal?.aborted) {
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
}
