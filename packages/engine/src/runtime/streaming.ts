/**
 * Streaming chat layer.
 *
 * `handleMessageStream` is an async generator that drives the existing
 * `runToolLoop` and emits structured events as they occur:
 *
 *   {type:'run', sessionId, runId, taskId} — emitted once when a runtime run starts
 *   {type:'token', text}         — one event per LLM response (full turn text)
 *   {type:'tool', name, args}    — emitted before each tool execution
 *   {type:'tool_result', name, result} — emitted after each tool execution
 *   {type:'final', text, usage?} — always last; text = stripped final answer
 *
 * Since our AI providers return `Promise<string>` (no native streaming),
 * each LLM turn produces exactly one `token` event carrying the full text of
 * that turn.  True character-by-character streaming can be wired in later by
 * replacing the `chat` function with one that chunks its output.
 */

import { runToolLoop } from './tool-loop';
import type { ChatFn, ToolExecFn, ToolLoopRunOptions, ToolLoopOptions } from './tool-loop';
import type { Message } from '../ai/providers/base';
import type { ToolDefinition, ToolContext } from './tools';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface OpenFile {
  path: string;
  content: string;
  language?: string;
}

export type StreamEvent =
  | { type: 'run'; sessionId: string; runId: string; taskId: string }
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'final'; text: string; usage?: { tokens?: number } };

export interface StreamOptions {
  /** AI chat function — same signature as `ChatFn` in tool-loop. */
  chat: ChatFn;
  /** Tool executor. Defaults to a no-op (no tools). */
  exec?: ToolExecFn;
  /** Tool definitions to expose to the model. */
  tools?: ToolDefinition[];
  /** Tool execution context (userId, sessionId, …). */
  toolCtx?: ToolContext;
  /** Provider / model selection forwarded to the loop. */
  runOpts?: ToolLoopRunOptions;
  /** Advanced loop options (maxIterations, timeouts, …). */
  loopOpts?: ToolLoopOptions;
}

// ─── Context-file helpers ──────────────────────────────────────────────────

const OPEN_FILES_HARD_CAP = 64 * 1024; // 64 KB combined

/**
 * Builds a `<context_files>` XML block from the supplied open files.
 * Truncates combined content at 64 KB (in path order) and appends a marker.
 */
export function buildContextBlock(openFiles: OpenFile[]): string {
  let total = 0;
  const parts: string[] = [];
  let truncated = false;

  for (const f of openFiles) {
    if (total + f.content.length > OPEN_FILES_HARD_CAP) {
      truncated = true;
      break;
    }
    total += f.content.length;
    const lang = f.language ?? '';
    parts.push(`<file path="${f.path}" lang="${lang}">${f.content}</file>`);
  }

  const inner = parts.join('\n') + (truncated ? '\n… [truncated]' : '');
  return `<context_files>\n${inner}\n</context_files>`;
}

// ─── Core generator ────────────────────────────────────────────────────────

/**
 * Async generator that streams events from a tool-loop run.
 *
 * @param messages  Full conversation history including the new user message.
 * @param options   Chat function, exec function, tools, …
 */
export async function* handleMessageStream(
  messages: Message[],
  options: StreamOptions,
): AsyncGenerator<StreamEvent> {
  // ── Event queue / notify pattern ──────────────────────────────────────
  // The tool loop runs concurrently; it pushes events into the queue and
  // wakes the generator via `notify`.
  type QueueItem = StreamEvent | Error | null; // null = sentinel (done)
  const queue: QueueItem[] = [];
  let notify: () => void = () => {};

  const push = (item: QueueItem): void => {
    queue.push(item);
    notify();
  };

  // ── Wrap chat to emit token events ────────────────────────────────────
  const wrappedChat: ChatFn = async (msgs, opts) => {
    const text = await options.chat(msgs, opts);
    push({ type: 'token', text });
    return text;
  };

  // ── Wrap exec to emit tool / tool_result events ───────────────────────
  const noopExec: ToolExecFn = async () => ({ success: true, data: {} });
  const execFn = options.exec ?? noopExec;
  const wrappedExec: ToolExecFn = async (name, args, ctx) => {
    push({ type: 'tool', name, args });
    const result = await execFn(name, args, ctx);
    push({ type: 'tool_result', name, result: result.data });
    return result;
  };

  // ── Start the loop (fire-and-forget, we drain the queue below) ────────
  const loopPromise = runToolLoop(
    messages,
    options.tools ?? [],
    wrappedChat,
    wrappedExec,
    options.toolCtx,
    options.runOpts ?? {},
    options.loopOpts ?? {},
  )
    .then((result) => {
      push({ type: 'final', text: result.finalText });
      push(null); // sentinel
    })
    .catch((err: unknown) => {
      push(err instanceof Error ? err : new Error(String(err)));
      push(null); // sentinel
    });

  // ── Drain queue ───────────────────────────────────────────────────────
  while (true) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        notify = r;
      });
    }
    const item = queue.shift()!;
    if (item === null) break;
    if (item instanceof Error) throw item;
    yield item;
  }

  // Ensure the loop promise is settled (re-throws if it rejected and we
  // somehow missed the error sentinel, which shouldn't happen in practice).
  await loopPromise;
}
