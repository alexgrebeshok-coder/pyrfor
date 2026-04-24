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
}

const DEFAULT_MAX_ITER = 5;
const DEFAULT_MAX_RESULT_CHARS = 8000;

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

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
// Lenient fallback: an opening <tool_call> with no closing tag (small models
// often forget the closer). Match from the tag to the next <tool_call> or EOS.
const TOOL_CALL_OPEN_RE = /<tool_call>\s*([\s\S]*?)(?=<tool_call>|$)/gi;

/**
 * Parse zero or more tool calls from assistant text.
 * Robust against minor JSON noise (trailing commas, single quotes) AND
 * against models that forget to emit `</tool_call>`.
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const seenSpans = new Set<string>();

  const tryParseBody = (body: string): { name: string; args: Record<string, unknown> } | null => {
    // Trim accidental closing tag fragments and trailing junk.
    let raw = body.replace(/<\/tool_call>\s*$/i, '').trim();
    // Sometimes the model wraps the JSON in a ```json fence inside the tag.
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw) return null;

    // Try to grab just the first balanced JSON object if there's noise after.
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
  };

  // Pass 1: well-formed <tool_call>...</tool_call>
  let match: RegExpExecArray | null;
  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const spanKey = `closed:${match.index}`;
    if (seenSpans.has(spanKey)) continue;
    seenSpans.add(spanKey);
    const parsed = tryParseBody(match[1]);
    if (parsed) calls.push({ ...parsed, raw: match[0] });
  }

  // Pass 2: lenient — only if pass 1 produced nothing.
  if (calls.length === 0) {
    TOOL_CALL_OPEN_RE.lastIndex = 0;
    while ((match = TOOL_CALL_OPEN_RE.exec(text)) !== null) {
      const parsed = tryParseBody(match[1]);
      if (parsed) calls.push({ ...parsed, raw: match[0] });
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

/** Strip all `<tool_call>...</tool_call>` blocks from text (closed and unclosed). */
export function stripToolCalls(text: string): string {
  return text
    .replace(TOOL_CALL_RE, '')
    .replace(/<tool_call>[\s\S]*$/i, '') // unclosed trailing block
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Serialize a tool result for the LLM, truncating if too large. */
function formatToolResult(call: ToolCall, result: ToolResult, maxChars: number): string {
  const header = `[tool_result name=${call.name}${result.success ? '' : ' status=error'}]`;
  let body: string;
  try {
    body = JSON.stringify(
      result.success ? { ok: true, data: result.data } : { ok: false, error: result.error },
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
  const maxIter = loopOpts.maxIterations ?? DEFAULT_MAX_ITER;
  const maxChars = loopOpts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;

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

    // Execute each tool call, accumulate results in one user message
    const resultParts: string[] = [];
    for (const call of calls) {
      logger.info('Tool call', {
        name: call.name,
        sessionId: runOpts.sessionId,
        argsPreview: JSON.stringify(call.args).slice(0, 200),
      });
      let result: ToolResult;
      try {
        result = await exec(call.name, call.args, toolCtx);
      } catch (err) {
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
}
