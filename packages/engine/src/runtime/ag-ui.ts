import { randomUUID } from 'node:crypto';
import type { LedgerEvent } from './event-ledger';
import type { StreamEvent } from './streaming';
import type { ConceptInput, ConceptRecord, ConceptStatus } from './universal/engine-loop';

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
  mode?: 'chat' | 'concept';
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
  concept?: {
    conceptId?: string;
    projectId?: string;
    parentConceptId?: string;
    retryOf?: string;
    dryRun?: boolean;
    strategies?: string[];
  };
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
    conceptId?: string;
    currentPhase?: string;
    phases?: string[];
    artifactIds?: string[];
  };
  interrupts?: AgUiInterrupt[];
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
  const conceptBody = isRecord(body.concept) ? body.concept : undefined;
  const concept = conceptBody
    ? {
      ...(typeof conceptBody.conceptId === 'string' ? { conceptId: conceptBody.conceptId } : {}),
      ...(typeof conceptBody.projectId === 'string' ? { projectId: conceptBody.projectId } : {}),
      ...(typeof conceptBody.parentConceptId === 'string' ? { parentConceptId: conceptBody.parentConceptId } : {}),
      ...(typeof conceptBody.retryOf === 'string' ? { retryOf: conceptBody.retryOf } : {}),
      ...(typeof conceptBody.dryRun === 'boolean' ? { dryRun: conceptBody.dryRun } : {}),
      ...(Array.isArray(conceptBody.strategies)
        ? {
          strategies: conceptBody.strategies.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0),
        }
        : {}),
    }
    : undefined;
  const openFiles = normalizeOpenFiles(body.openFiles);
  return {
    ok: true,
    input: {
      ...(body.mode === 'chat' || body.mode === 'concept' ? { mode: body.mode } : {}),
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
      ...(concept && Object.keys(concept).length > 0 ? { concept } : {}),
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

function mapConceptStatus(status: ConceptStatus): AgUiRunState['status'] {
  if (status === 'done') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'aborted') return 'interrupted';
  return 'running';
}

function recordLedgerEventKey(event: LedgerEvent): string | null {
  if (typeof (event as { id?: unknown }).id === 'string') return (event as { id: string }).id;
  if (typeof (event as { seq?: unknown }).seq === 'number') {
    return `${event.run_id}:${event.type}:${String((event as { seq: number }).seq)}`;
  }
  return null;
}

function formatConceptProgress(event: LedgerEvent): string | null {
  if (event.type === 'dag.node.started' && typeof event.node_id === 'string') {
    return `${event.node_id} phase started`;
  }
  if (event.type === 'dag.node.completed' && typeof event.node_id === 'string') {
    return `${event.node_id} phase completed`;
  }
  if (event.type === 'approval.requested') {
    return event.reason ? `Approval required: ${event.reason}` : 'Approval required';
  }
  if (event.type === 'approval.granted') return 'Approval granted';
  if (event.type === 'approval.denied') return event.reason ? `Approval denied: ${event.reason}` : 'Approval denied';
  if (event.type === 'run.blocked') return event.reason ? `Run blocked: ${event.reason}` : 'Run blocked';
  if (event.type === 'run.failed') return event.error ? `Run failed: ${event.error}` : 'Run failed';
  if (event.type === 'run.cancelled') return event.reason ? `Run cancelled: ${event.reason}` : 'Run cancelled';
  if (event.type === 'concept.completed') {
    return event.status === 'done' ? 'Concept completed' : `Concept completed with status ${event.status ?? 'unknown'}`;
  }
  return null;
}

export function toAgUiConceptInput(request: AgUiRunRequest, defaultWorkspace?: string): ConceptInput {
  return {
    goal: request.promptText,
    ...(request.workspace ?? defaultWorkspace ? { workspaceId: request.workspace ?? defaultWorkspace } : {}),
    ...(request.runId ? { runId: request.runId } : {}),
    ...(request.concept?.conceptId ? { conceptId: request.concept.conceptId } : {}),
    ...(request.concept?.projectId ? { projectId: request.concept.projectId } : {}),
    ...(request.concept?.parentConceptId ? { parentConceptId: request.concept.parentConceptId } : {}),
    ...(request.concept?.retryOf ? { retryOf: request.concept.retryOf } : {}),
    ...(typeof request.concept?.dryRun === 'boolean' ? { dryRun: request.concept.dryRun } : {}),
    ...(request.concept?.strategies?.length ? { strategies: request.concept.strategies } : {}),
  };
}

export function createAgUiConceptProjector(
  record: Pick<ConceptRecord, 'conceptId' | 'runId' | 'status' | 'currentPhase' | 'phases' | 'artifactRefs'>,
  request: AgUiRunRequest,
  opts?: { clock?: () => number },
): {
  snapshot: (events: Iterable<LedgerEvent>) => AgUiEvent[];
  project: (event: LedgerEvent) => AgUiEvent[];
  isTerminal: () => boolean;
} {
  const clock = opts?.clock ?? (() => Date.now());
  const threadId = request.threadId ?? record.conceptId;
  const runId = request.runId ?? record.runId ?? randomUUID();
  const state = createInitialState(request, threadId, runId);
  state.status = mapConceptStatus(record.status);
  state.runtime = {
    runId: record.runId,
    conceptId: record.conceptId,
    ...(record.currentPhase ? { currentPhase: record.currentPhase } : {}),
    phases: [...record.phases],
    artifactIds: record.artifactRefs.map((ref) => ref.id),
  };

  let started = false;
  let terminal = false;
  const seen = new Set<string>();

  const start = (): AgUiEvent[] => {
    if (started) return [];
    started = true;
    return [
      {
        type: 'RUN_STARTED',
        threadId,
        runId,
        ...(request.parentRunId ? { parentRunId: request.parentRunId } : {}),
        input: {
          mode: 'concept',
          threadId,
          runId,
          ...(request.parentRunId ? { parentRunId: request.parentRunId } : {}),
          state: request.state,
          messages: request.messages,
          tools: request.tools,
          context: request.context,
          forwardedProps: request.forwardedProps,
          ...(request.concept ? { concept: request.concept } : {}),
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
    const messageId = randomUUID();
    const draftOp: JsonPatchOperation['op'] = state.draftText === undefined ? 'add' : 'replace';
    state.messages.push({ id: messageId, role: 'assistant', content: text });
    state.draftText = text;
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

  const ensureInterrupts = (): AgUiInterrupt[] => {
    if (!state.interrupts) state.interrupts = [];
    return state.interrupts;
  };

  const removeInterrupts = (approvalId?: string): JsonPatchOperation[] => {
    if (!state.interrupts || state.interrupts.length === 0) return [];
    if (!approvalId) {
      state.interrupts = [];
      return [{ op: 'replace', path: '/interrupts', value: [] }];
    }
    const nextInterrupts = state.interrupts.filter((entry) => entry.id !== approvalId);
    if (nextInterrupts.length === state.interrupts.length) return [];
    state.interrupts = nextInterrupts;
    return [{ op: 'replace', path: '/interrupts', value: nextInterrupts }];
  };

  const setStatus = (status: AgUiRunState['status'], delta: JsonPatchOperation[]): void => {
    if (state.status === status) return;
    state.status = status;
    delta.push({ op: 'replace', path: '/status', value: status });
  };

  const setCurrentPhase = (phase: string | undefined, delta: JsonPatchOperation[]): void => {
    if (phase === undefined) return;
    if (state.runtime.currentPhase === phase) return;
    const op: JsonPatchOperation['op'] = state.runtime.currentPhase ? 'replace' : 'add';
    state.runtime.currentPhase = phase;
    delta.push({ op, path: '/runtime/currentPhase', value: phase });
  };

  const ensurePhase = (phase: string | undefined, delta: JsonPatchOperation[]): void => {
    if (!phase) return;
    const phases = state.runtime.phases ?? (state.runtime.phases = []);
    if (phases.includes(phase)) return;
    phases.push(phase);
    delta.push({ op: 'add', path: '/runtime/phases/-', value: phase });
  };

  const ensureArtifact = (artifactId: string | undefined, delta: JsonPatchOperation[]): void => {
    if (!artifactId) return;
    const artifactIds = state.runtime.artifactIds ?? (state.runtime.artifactIds = []);
    if (artifactIds.includes(artifactId)) return;
    artifactIds.push(artifactId);
    delta.push({ op: 'add', path: '/runtime/artifactIds/-', value: artifactId });
  };

  const emitTerminalEvent = (message?: string): AgUiEvent[] => {
    if (state.status === 'failed') {
      return [{ type: 'RUN_ERROR', message: message ?? state.lastError?.message ?? 'run_failed', timestamp: clock() }];
    }
    if (state.status === 'interrupted') {
      return [{
        type: 'RUN_FINISHED',
        threadId: state.threadId,
        runId: state.runId,
        outcome: {
          type: 'interrupt',
          interrupts: state.interrupts && state.interrupts.length > 0
            ? state.interrupts
            : [{ id: `interrupt-${state.runId}`, reason: 'run_interrupted', ...(message ? { message } : {}) }],
        },
        timestamp: clock(),
      }];
    }
    return [{
      type: 'RUN_FINISHED',
      threadId: state.threadId,
      runId: state.runId,
      result: {
        conceptId: state.runtime.conceptId,
        status: 'done',
        phases: state.runtime.phases ?? [],
        artifactIds: state.runtime.artifactIds ?? [],
      },
      outcome: { type: 'success' },
      timestamp: clock(),
    }];
  };

  const apply = (event: LedgerEvent, emitMessages: boolean): AgUiEvent[] => {
    const key = recordLedgerEventKey(event);
    if (key && seen.has(key)) return [];
    if (key) seen.add(key);

    const delta: JsonPatchOperation[] = [];
    let terminalEvents: AgUiEvent[] = [];

    if (event.type === 'concept.received') {
      setCurrentPhase('plan', delta);
      setStatus('running', delta);
    } else if (event.type === 'concept.planned') {
      ensurePhase('plan', delta);
      setCurrentPhase('plan', delta);
      ensureArtifact(event.plan_id, delta);
    } else if (event.type === 'research.started') {
      setCurrentPhase('research', delta);
      setStatus('running', delta);
    } else if (event.type === 'research.completed') {
      ensurePhase('research', delta);
      ensureArtifact(event.research_id, delta);
    } else if (event.type === 'critique.started') {
      setCurrentPhase('critique', delta);
      setStatus('running', delta);
    } else if (event.type === 'critique.completed') {
      ensurePhase('critique', delta);
      ensureArtifact(event.critique_id, delta);
    } else if (event.type === 'postmortem.started') {
      setCurrentPhase('postmortem', delta);
      setStatus('running', delta);
    } else if (event.type === 'postmortem.completed') {
      ensurePhase('postmortem', delta);
      ensureArtifact(event.artifact_id, delta);
    } else if (event.type === 'memory.written') {
      ensurePhase('memory_persist', delta);
      setCurrentPhase('memory_persist', delta);
      if (Array.isArray(event.artifact_refs)) {
        for (const artifactId of event.artifact_refs.filter((entry): entry is string => typeof entry === 'string')) {
          ensureArtifact(artifactId, delta);
        }
      }
    } else if (event.type === 'dag.node.started' && typeof event.node_id === 'string') {
      setCurrentPhase(event.node_id, delta);
      setStatus('running', delta);
    } else if (event.type === 'dag.node.completed' && typeof event.node_id === 'string') {
      ensurePhase(event.node_id, delta);
      if (Array.isArray(event.artifact_refs)) {
        for (const artifactId of event.artifact_refs.filter((entry): entry is string => typeof entry === 'string')) {
          ensureArtifact(artifactId, delta);
        }
      }
    } else if (event.type === 'artifact.created') {
      ensureArtifact(event.artifact_id, delta);
    } else if (event.type === 'approval.requested') {
      const interrupts = ensureInterrupts();
      const previousLength = interrupts.length;
      const interruptId = event.approval_id ?? `approval-${event.run_id}-${interrupts.length + 1}`;
      if (!interrupts.some((entry) => entry.id === interruptId)) {
        const interrupt: AgUiInterrupt = {
          id: interruptId,
          reason: 'approval_required',
          ...(event.reason ? { message: event.reason } : {}),
          ...(event.tool ? { metadata: { tool: event.tool } } : {}),
        };
        interrupts.push(interrupt);
        delta.push({ op: previousLength === 0 ? 'add' : 'replace', path: '/interrupts', value: [...interrupts] });
      }
      setStatus('interrupted', delta);
    } else if (event.type === 'approval.granted') {
      delta.push(...removeInterrupts(event.approval_id));
      setStatus('running', delta);
    } else if (event.type === 'approval.denied') {
      const interrupts = ensureInterrupts();
      const previousLength = interrupts.length;
      const interruptId = event.approval_id ?? `approval-denied-${event.run_id}`;
      if (!interrupts.some((entry) => entry.id === interruptId)) {
        interrupts.push({
          id: interruptId,
          reason: 'approval_denied',
          ...(event.reason ? { message: event.reason } : {}),
          ...(event.tool ? { metadata: { tool: event.tool } } : {}),
        });
        delta.push({ op: previousLength === 0 ? 'add' : 'replace', path: '/interrupts', value: [...interrupts] });
      }
      setStatus('interrupted', delta);
    } else if (event.type === 'run.blocked') {
      const interrupts = ensureInterrupts();
      const previousLength = interrupts.length;
      interrupts.push({
        id: `run-blocked-${event.run_id}-${interrupts.length + 1}`,
        reason: 'run_blocked',
        ...(event.reason ? { message: event.reason } : {}),
      });
      delta.push({ op: previousLength === 0 ? 'add' : 'replace', path: '/interrupts', value: [...interrupts] });
      setStatus('interrupted', delta);
    } else if (event.type === 'run.failed') {
      const hadLastError = state.lastError !== undefined;
      state.lastError = { message: event.error ?? 'run_failed' };
      delta.push({ op: hadLastError ? 'replace' : 'add', path: '/lastError', value: state.lastError });
      setStatus('failed', delta);
      terminal = true;
      terminalEvents = emitTerminalEvent(event.error);
    } else if (event.type === 'run.cancelled') {
      setStatus('interrupted', delta);
      terminal = true;
      terminalEvents = emitTerminalEvent(event.reason);
    } else if (event.type === 'concept.completed') {
      if (event.status === 'done') {
        setStatus('completed', delta);
      } else if (event.status === 'aborted') {
        setStatus('interrupted', delta);
      } else if (event.status === 'failed') {
        const hadLastError = state.lastError !== undefined;
        state.lastError = { message: event.error ?? 'concept_failed' };
        delta.push({ op: hadLastError ? 'replace' : 'add', path: '/lastError', value: state.lastError });
        setStatus('failed', delta);
      }
      terminal = true;
      terminalEvents = emitTerminalEvent(event.reason ?? event.error);
    }

    const out: AgUiEvent[] = [];
    if (emitMessages) {
      const progressText = formatConceptProgress(event);
      if (progressText) out.push(...emitTextMessage(progressText));
    }
    if (delta.length > 0) out.push({ type: 'STATE_DELTA', delta, timestamp: clock() });
    out.push(...terminalEvents);
    return out;
  };

  return {
    snapshot(events: Iterable<LedgerEvent>): AgUiEvent[] {
      for (const event of events) apply(event, false);
      const out = start();
      if (terminal) out.push(...emitTerminalEvent(state.lastError?.message));
      return out;
    },
    project(event: LedgerEvent): AgUiEvent[] {
      if (terminal) return [];
      const out = start();
      out.push(...apply(event, true));
      return out;
    },
    isTerminal(): boolean {
      return terminal;
    },
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
