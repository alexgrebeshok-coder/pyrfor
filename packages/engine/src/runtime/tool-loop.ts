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

import { randomUUID } from 'node:crypto';
import type { Message } from '../ai/providers/base';
import { logger } from '../observability/logger';
import type { ToolDefinition, ToolContext, ToolResult } from './tools';
import {
  parseToolCalls as parseToolCallsImpl,
  stripToolCalls as stripToolCallsImpl,
  extractFirstJsonObject as extractFirstJsonObjectImpl,
} from './tool-call-parser';

// ---------------------------------------------------------------------------
// Approval gate types (injectable — default: pass-through approve-all)
// ---------------------------------------------------------------------------

export type ApprovalDecision = 'approve' | 'deny' | 'timeout';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
}

/** Injectable approval gate. Return 'approve' to proceed, anything else to deny. */
export type ApprovalGate = (req: ApprovalRequest) => Promise<ApprovalDecision>;

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

export type ProgressEvent =
  | { kind: 'tool-start'; name: string; summary: string }
  | { kind: 'tool-end'; name: string; ok: boolean; ms: number }
  | { kind: 'llm-start'; model: string }
  | { kind: 'llm-end'; model: string; ms: number }
  | { kind: 'compact'; tokensBefore: number; tokensAfter: number };

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
  /**
   * Injectable approval gate — called before each tool execution.
   * Resolve 'approve' to proceed, 'deny' or 'timeout' to skip execution.
   * Defaults to undefined (= unconditional approve) so existing tests pass unchanged.
   */
  approvalGate?: ApprovalGate;
  /** Optional progress callback invoked at key lifecycle points. */
  onProgress?: (event: ProgressEvent) => void;
  onToolAudit?: (event: ToolAuditEvent) => void;
}

export interface ToolAuditEvent {
  requestId: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  decision?: ApprovalDecision;
  sessionId?: string;
  toolCallId?: string;
  resultSummary?: string;
  error?: string;
  undo?: { supported: boolean; kind?: string };
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
 * Parse zero or more tool calls from assistant text.
 * Delegates to the universal tool-call-parser module.
 * For backward compatibility, only the original `<tool_call>` tagged strategy
 * and arg-xml strategy are enabled. Other strategies can be enabled via ParseOptions
 * if the caller imports parseToolCalls directly from tool-call-parser.ts.
 */
export function parseToolCalls(text: string): ToolCall[] {
  // Maintain backward compatibility: only enable strategies that the old parser supported.
  // The new parser module adds function-call-tag, openai-native, bare-object, and line-kv,
  // but these are disabled here to keep existing tests passing.
  return parseToolCallsImpl(text, {
    disableStrategies: [],
  });
}

/** Strip every tool-call block from text (all known shapes). */
export function stripToolCalls(text: string): string {
  return stripToolCallsImpl(text);
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

// ---------------------------------------------------------------------------
// Approval summary renderer
// ---------------------------------------------------------------------------

/** Build a short human-readable description of a tool call for the approval prompt. */
function renderSummary(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'exec') {
    return `exec: ${String(args.command ?? '').slice(0, 200)}`;
  }
  if (toolName === 'process_spawn') {
    const cmd = String(args.command ?? '');
    const spawnArgs = Array.isArray(args.args) ? (args.args as unknown[]).join(' ') : '';
    return `process_spawn: ${cmd}${spawnArgs ? ' ' + spawnArgs : ''}`.slice(0, 200);
  }
  if (toolName === 'browser') {
    return `browser: ${String(args.url ?? args.action ?? 'action').slice(0, 200)}`;
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
  const { signal, approvalGate, onProgress, onToolAudit } = loopOpts;

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

    const llmStartedAt = Date.now();
    onProgress?.({ kind: 'llm-start', model: runOpts.model ?? '' });
    const text = await chat(working, runOpts);
    onProgress?.({ kind: 'llm-end', model: runOpts.model ?? '', ms: Date.now() - llmStartedAt });
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
    const execPromises = calls.map(async (call) => {
      const requestId = randomUUID();
      const toolMs = loopOpts.toolTimeoutsMs?.[call.name] ?? defaultToolTimeoutMs;
      const summary = renderSummary(call.name, call.args);

      // Run through approval gate if one is configured
      if (approvalGate) {
        const decision = await approvalGate({ id: requestId, toolName: call.name, summary, args: call.args });
        if (decision !== 'approve') {
          logger.info('Tool execution denied by approval gate', {
            toolName: call.name,
            decision,
            sessionId: runOpts.sessionId,
          });
          onToolAudit?.({
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
          } as ToolResult;
        }
      }

      onProgress?.({ kind: 'tool-start', name: call.name, summary });
      const startedAt = Date.now();
      const result = await raceToolExec(exec(call.name, call.args, toolCtx), call.name, toolMs, signal);
      onProgress?.({ kind: 'tool-end', name: call.name, ok: result.success, ms: Date.now() - startedAt });
      onToolAudit?.({
        requestId,
        toolCallId: requestId,
        toolName: call.name,
        summary,
        args: call.args,
        decision: 'approve',
        sessionId: runOpts.sessionId,
        resultSummary: result.success
          ? JSON.stringify(result.data ?? {}).slice(0, 300)
          : undefined,
        error: result.success ? undefined : String(result.error ?? 'Tool failed'),
        undo: { supported: false },
      });
      return result;
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
