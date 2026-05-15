import { randomUUID } from 'node:crypto';
import type { StreamEvent } from './streaming';

export type JsonPatchOperation = {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
};

export type AgUiMessageRole = 'developer' | 'system' | 'assistant' | 'user' | 'tool';

export interface AgUiMessageInput {
  id?: string;
  role?: AgUiMessageRole;
  content?: unknown;
  name?: string;
}

export interface AgUiRunRequest {
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  state: unknown;
  messages: AgUiMessageInput[];
  tools: unknown[];
  context: unknown[];
  forwardedProps: Record<string, unknown>;
  promptText: string;
  sessionId?: string;
  workspace?: string;
  openFiles?: Array<{ path: string; content: string; language?: string }>;
  prefer?: 'local' | 'cloud' | 'auto';
  routingHints?: { contextSizeChars?: number; sensitive?: boolean };
  exposeToolPayloads?: boolean;
}

export interface AgUiInterrupt {
  id: string;
  reason: string;
  message?: string;
  toolCallId?: string;
  responseSchema?: unknown;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgUiStateMessage {
  id: string;
  role: 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface AgUiStateToolCall {
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
  argsText: string;
  status: 'pending' | 'completed';
  ok?: boolean;
  resultContent?: string;
  resultMessageId?: string;
}

export interface AgUiRunState {
  threadId: string;
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  request: {
    text: string;
    workspace?: string;
    prefer?: 'local' | 'cloud' | 'auto';
  };
  runtime: {
    sessionId?: string;
    runId?: string;
    taskId?: string;
  };
  sharedState: unknown;
  messages: AgUiStateMessage[];
  toolCalls: AgUiStateToolCall[];
  draftText?: string;
  finalText?: string;
  lastError?: { message: string; code?: string };
}

type AgUiBaseEvent = {
  type: string;
  timestamp?: number;
  rawEvent?: unknown;
};

export type AgUiEvent =
  | (AgUiBaseEvent & { type: 'RUN_STARTED'; threadId: string; runId: string; parentRunId?: string; input: Record<string, unknown> })
  | (AgUiBaseEvent & { type: 'RUN_FINISHED'; threadId: string; runId: string; result?: unknown; outcome?: { type: 'success' } | { type: 'interrupt'; interrupts: AgUiInterrupt[] } })
  | (AgUiBaseEvent & { type: 'RUN_ERROR'; message: string; code?: string })
  | (AgUiBaseEvent & { type: 'TEXT_MESSAGE_START'; messageId: string; role: 'assistant' })
  | (AgUiBaseEvent & { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string })
  | (AgUiBaseEvent & { type: 'TEXT_MESSAGE_END'; messageId: string })
  | (AgUiBaseEvent & { type: 'TOOL_CALL_START'; toolCallId: string; toolCallName: string; parentMessageId?: string })
  | (AgUiBaseEvent & { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string })
  | (AgUiBaseEvent & { type: 'TOOL_CALL_END'; toolCallId: string })
  | (AgUiBaseEvent & { type: 'TOOL_CALL_RESULT'; messageId: string; toolCallId: string; content: string; role: 'tool' })
  | (AgUiBaseEvent & { type: 'STATE_SNAPSHOT'; snapshot: AgUiRunState })
  | (AgUiBaseEvent & { type: 'STATE_DELTA'; delta: JsonPatchOperation[] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractMessageText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .map((entry) => {
      if (!isRecord(entry)) return null;
      return entry.type === 'text' && typeof entry.text === 'string' ? entry.text : null;
    })
    .filter((entry): entry is string => typeof entry === 'string');
  return parts.length > 0 ? parts.join('\n') : null;
}

function normalizeOpenFiles(value: unknown): Array<{ path: string; content: string; language?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.content !== 'string') return [];
    return [{
      path: entry.path,
      content: entry.content,
      ...(typeof entry.language === 'string' ? { language: entry.language } : {}),
    }];
  });
  return out.length > 0 ? out : undefined;
}

export function parseAgUiRunRequest(body: unknown): { ok: true; input: AgUiRunRequest } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'invalid_json' };
  const messages = Array.isArray(body.messages)
    ? body.messages.filter((entry): entry is AgUiMessageInput => isRecord(entry))
    : [];
  const promptText = typeof body.text === 'string'
    ? body.text
    : [...messages].reverse().flatMap((message) => {
      if (message.role !== 'user') return [];
      const text = extractMessageText(message.content);
      return text ? [text] : [];
    })[0];
  if (typeof promptText !== 'string' || promptText.trim() === '') {
    return { ok: false, error: 'text_required' };
  }
  const forwardedProps = isRecord(body.forwardedProps) ? body.forwardedProps : {};
  const openFiles = normalizeOpenFiles(body.openFiles);
  return {
    ok: true,
    input: {
      ...(typeof body.threadId === 'string' ? { threadId: body.threadId } : {}),
      ...(typeof body.runId === 'string' ? { runId: body.runId } : {}),
      ...(typeof body.parentRunId === 'string' ? { parentRunId: body.parentRunId } : {}),
      state: body.state ?? {},
      messages,
      tools: Array.isArray(body.tools) ? body.tools : [],
      context: Array.isArray(body.context) ? body.context : [],
      forwardedProps,
      promptText,
      ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
      ...(typeof body.workspace === 'string' ? { workspace: body.workspace } : {}),
      ...(openFiles ? { openFiles } : {}),
      ...(body.prefer === 'local' || body.prefer === 'cloud' || body.prefer === 'auto' ? { prefer: body.prefer } : {}),
      ...(isRecord(body.routingHints) ? { routingHints: body.routingHints as { contextSizeChars?: number; sensitive?: boolean } } : {}),
      ...(typeof body.exposeToolPayloads === 'boolean' ? { exposeToolPayloads: body.exposeToolPayloads } : {}),
    },
  };
}

function cloneState(state: AgUiRunState): AgUiRunState {
  return JSON.parse(JSON.stringify(state)) as AgUiRunState;
}

function formatPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'null';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return String(error);
}

function toInterrupts(error: unknown): AgUiInterrupt[] | null {
  const record = isRecord(error) ? error : undefined;
  const candidate = Array.isArray(record?.interrupts)
    ? record.interrupts
    : isRecord(record?.outcome) && record.outcome.type === 'interrupt' && Array.isArray(record.outcome.interrupts)
      ? record.outcome.interrupts
      : null;
  if (!candidate || candidate.length === 0) return null;
  const interrupts = candidate.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.reason !== 'string') return [];
    return [{
      id: entry.id,
      reason: entry.reason,
      ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
      ...(typeof entry.toolCallId === 'string' ? { toolCallId: entry.toolCallId } : {}),
      ...('responseSchema' in entry ? { responseSchema: entry.responseSchema } : {}),
      ...(typeof entry.expiresAt === 'string' ? { expiresAt: entry.expiresAt } : {}),
      ...(isRecord(entry.metadata) ? { metadata: entry.metadata } : {}),
    }];
  });
  return interrupts.length > 0 ? interrupts : null;
}

function createInitialState(request: AgUiRunRequest, threadId: string, runId: string): AgUiRunState {
  return {
    threadId,
    runId,
    status: 'running',
    request: {
      text: request.promptText,
      ...(request.workspace ? { workspace: request.workspace } : {}),
      ...(request.prefer ? { prefer: request.prefer } : {}),
    },
    runtime: {},
    sharedState: request.state,
    messages: [],
    toolCalls: [],
  };
}

export async function* createAgUiEventStream(
  source: AsyncIterable<StreamEvent>,
  request: AgUiRunRequest,
  opts?: { clock?: () => number },
): AsyncGenerator<AgUiEvent> {
  const clock = opts?.clock ?? (() => Date.now());
  let state: AgUiRunState | undefined;
  let started = false;
  let terminal = false;
  let lastAssistantMessageId: string | undefined;
  let lastAssistantText: string | undefined;

  const start = (runtime?: { sessionId?: string; runId?: string; taskId?: string }): AgUiEvent[] => {
    if (started && state) {
      if (runtime) {
        const delta: JsonPatchOperation[] = [];
        if (runtime.sessionId && state.runtime.sessionId !== runtime.sessionId) {
          const op: JsonPatchOperation['op'] = state.runtime.sessionId ? 'replace' : 'add';
          state.runtime.sessionId = runtime.sessionId;
          delta.push({ op, path: '/runtime/sessionId', value: runtime.sessionId });
        }
        if (runtime.runId && state.runtime.runId !== runtime.runId) {
          const op: JsonPatchOperation['op'] = state.runtime.runId ? 'replace' : 'add';
          state.runtime.runId = runtime.runId;
          delta.push({ op, path: '/runtime/runId', value: runtime.runId });
        }
        if (runtime.taskId && state.runtime.taskId !== runtime.taskId) {
          const op: JsonPatchOperation['op'] = state.runtime.taskId ? 'replace' : 'add';
          state.runtime.taskId = runtime.taskId;
          delta.push({ op, path: '/runtime/taskId', value: runtime.taskId });
        }
        return delta.length > 0 ? [{ type: 'STATE_DELTA', delta, timestamp: clock() }] : [];
      }
      return [];
    }
    const threadId = request.threadId ?? runtime?.sessionId ?? randomUUID();
    const runId = request.runId ?? runtime?.runId ?? randomUUID();
    state = createInitialState(request, threadId, runId);
    if (runtime) state.runtime = { ...runtime };
    started = true;
    return [
      {
        type: 'RUN_STARTED',
        threadId,
        runId,
        ...(request.parentRunId ? { parentRunId: request.parentRunId } : {}),
        input: {
          threadId,
          runId,
          ...(request.parentRunId ? { parentRunId: request.parentRunId } : {}),
          state: request.state,
          messages: request.messages,
          tools: request.tools,
          context: request.context,
          forwardedProps: request.forwardedProps,
        },
        timestamp: clock(),
      },
      {
        type: 'STATE_SNAPSHOT',
        snapshot: cloneState(state),
        timestamp: clock(),
      },
    ];
  };

  const emitTextMessage = (text: string): AgUiEvent[] => {
    if (!state) return [];
    const messageId = randomUUID();
    const draftOp: JsonPatchOperation['op'] = state.draftText === undefined ? 'add' : 'replace';
    state.messages.push({ id: messageId, role: 'assistant', content: text });
    state.draftText = text;
    lastAssistantMessageId = messageId;
    lastAssistantText = text;
    const message = state.messages[state.messages.length - 1];
    return [
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', timestamp: clock() },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text, timestamp: clock() },
      { type: 'TEXT_MESSAGE_END', messageId, timestamp: clock() },
      {
        type: 'STATE_DELTA',
        delta: [
          { op: 'add', path: '/messages/-', value: message },
          { op: draftOp, path: '/draftText', value: text },
        ],
        timestamp: clock(),
      },
    ];
  };

  try {
    for await (const streamEvent of source) {
      if (streamEvent.type === 'run') {
        for (const event of start({
          sessionId: streamEvent.sessionId,
          runId: streamEvent.runId,
          taskId: streamEvent.taskId,
        })) yield event;
        continue;
      }
      for (const event of start()) yield event;
      if (!state) continue;

      if (streamEvent.type === 'token') {
        for (const event of emitTextMessage(streamEvent.text)) yield event;
        continue;
      }

      if (streamEvent.type === 'tool') {
        const toolCallId = streamEvent.toolCallId ?? randomUUID();
        const argsText = formatPayload(streamEvent.args);
        state.toolCalls.push({
          toolCallId,
          toolCallName: streamEvent.name,
          ...(lastAssistantMessageId ? { parentMessageId: lastAssistantMessageId } : {}),
          argsText,
          status: 'pending',
        });
        const toolCall = state.toolCalls[state.toolCalls.length - 1];
        yield {
          type: 'TOOL_CALL_START',
          toolCallId,
          toolCallName: streamEvent.name,
          ...(lastAssistantMessageId ? { parentMessageId: lastAssistantMessageId } : {}),
          timestamp: clock(),
        };
        yield { type: 'TOOL_CALL_ARGS', toolCallId, delta: argsText, timestamp: clock() };
        yield { type: 'TOOL_CALL_END', toolCallId, timestamp: clock() };
        yield {
          type: 'STATE_DELTA',
          delta: [{ op: 'add', path: '/toolCalls/-', value: toolCall }],
          timestamp: clock(),
        };
        continue;
      }

      if (streamEvent.type === 'tool_result') {
        let toolIndex = -1;
        if (streamEvent.toolCallId) {
          toolIndex = state.toolCalls.findIndex((toolCall) =>
            toolCall.toolCallId === streamEvent.toolCallId && toolCall.status === 'pending');
        }
        if (toolIndex === -1) {
          for (let index = 0; index < state.toolCalls.length; index++) {
            if (state.toolCalls[index]?.toolCallName === streamEvent.name && state.toolCalls[index]?.status === 'pending') {
              toolIndex = index;
              break;
            }
          }
        }
        if (toolIndex === -1) {
          state.toolCalls.push({
            toolCallId: streamEvent.toolCallId ?? randomUUID(),
            toolCallName: streamEvent.name,
            argsText: '{}',
            status: 'pending',
          });
          toolIndex = state.toolCalls.length - 1;
        }
        const toolCall = state.toolCalls[toolIndex]!;
        const content = formatPayload(streamEvent.result);
        const messageId = randomUUID();
        toolCall.status = 'completed';
        toolCall.ok = streamEvent.ok;
        toolCall.resultContent = content;
        toolCall.resultMessageId = messageId;
        state.messages.push({ id: messageId, role: 'tool', content, toolCallId: toolCall.toolCallId });
        const toolMessage = state.messages[state.messages.length - 1];
        yield {
          type: 'TOOL_CALL_RESULT',
          messageId,
          toolCallId: toolCall.toolCallId,
          content,
          role: 'tool',
          timestamp: clock(),
        };
        yield {
          type: 'STATE_DELTA',
          delta: [
            { op: 'replace', path: `/toolCalls/${toolIndex}/status`, value: 'completed' },
            { op: 'add', path: `/toolCalls/${toolIndex}/ok`, value: streamEvent.ok },
            { op: 'add', path: `/toolCalls/${toolIndex}/resultContent`, value: content },
            { op: 'add', path: `/toolCalls/${toolIndex}/resultMessageId`, value: messageId },
            { op: 'add', path: '/messages/-', value: toolMessage },
          ],
          timestamp: clock(),
        };
        continue;
      }

      if (streamEvent.type === 'final') {
        const delta: JsonPatchOperation[] = [];
        const finalTextOp: JsonPatchOperation['op'] = state.finalText === undefined ? 'add' : 'replace';
        if (streamEvent.text !== lastAssistantText) {
          for (const event of emitTextMessage(streamEvent.text)) yield event;
        }
        state.finalText = streamEvent.text;
        state.draftText = streamEvent.text;
        state.status = 'completed';
        delta.push(
          { op: finalTextOp, path: '/finalText', value: streamEvent.text },
          { op: 'replace', path: '/draftText', value: streamEvent.text },
          { op: 'replace', path: '/status', value: 'completed' },
        );
        yield { type: 'STATE_DELTA', delta, timestamp: clock() };
        yield {
          type: 'RUN_FINISHED',
          threadId: state.threadId,
          runId: state.runId,
          result: {
            text: streamEvent.text,
            ...(streamEvent.usage ? { usage: streamEvent.usage } : {}),
          },
          outcome: { type: 'success' },
          timestamp: clock(),
        };
        terminal = true;
      }
    }
  } catch (error) {
    for (const event of start()) yield event;
    if (!state) return;
    const interrupts = toInterrupts(error);
    const message = getErrorMessage(error);
    state.lastError = { message, ...(interrupts ? { code: 'interrupt' } : {}) };
    state.status = interrupts ? 'interrupted' : 'failed';
    yield {
      type: 'STATE_DELTA',
      delta: [
        { op: 'replace', path: '/status', value: state.status },
        { op: 'add', path: '/lastError', value: state.lastError },
      ],
      timestamp: clock(),
    };
    if (interrupts) {
      yield {
        type: 'RUN_FINISHED',
        threadId: state.threadId,
        runId: state.runId,
        outcome: { type: 'interrupt', interrupts },
        timestamp: clock(),
      };
    } else {
      yield {
        type: 'RUN_ERROR',
        message,
        ...(error instanceof Error && error.name ? { code: error.name } : {}),
        timestamp: clock(),
      };
    }
    terminal = true;
  }

  if (!terminal) {
    for (const event of start()) yield event;
    if (!state) return;
    state.status = 'completed';
    yield {
      type: 'STATE_DELTA',
      delta: [{ op: 'replace', path: '/status', value: 'completed' }],
      timestamp: clock(),
    };
    yield {
      type: 'RUN_FINISHED',
      threadId: state.threadId,
      runId: state.runId,
      outcome: { type: 'success' },
      timestamp: clock(),
    };
  }
}
