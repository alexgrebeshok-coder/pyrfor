import type { LedgerEvent } from './event-ledger';
import type { StreamEvent } from './streaming';
import type { ConceptInput, ConceptRecord } from './universal/engine-loop';
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
    openFiles?: Array<{
        path: string;
        content: string;
        language?: string;
    }>;
    prefer?: 'local' | 'cloud' | 'auto';
    routingHints?: {
        contextSizeChars?: number;
        sensitive?: boolean;
    };
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
    lastError?: {
        message: string;
        code?: string;
    };
}
type AgUiBaseEvent = {
    type: string;
    timestamp?: number;
    rawEvent?: unknown;
};
export type AgUiEvent = (AgUiBaseEvent & {
    type: 'RUN_STARTED';
    threadId: string;
    runId: string;
    parentRunId?: string;
    input: Record<string, unknown>;
}) | (AgUiBaseEvent & {
    type: 'RUN_FINISHED';
    threadId: string;
    runId: string;
    result?: unknown;
    outcome?: {
        type: 'success';
    } | {
        type: 'interrupt';
        interrupts: AgUiInterrupt[];
    };
}) | (AgUiBaseEvent & {
    type: 'RUN_ERROR';
    message: string;
    code?: string;
}) | (AgUiBaseEvent & {
    type: 'TEXT_MESSAGE_START';
    messageId: string;
    role: 'assistant';
}) | (AgUiBaseEvent & {
    type: 'TEXT_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
}) | (AgUiBaseEvent & {
    type: 'TEXT_MESSAGE_END';
    messageId: string;
}) | (AgUiBaseEvent & {
    type: 'TOOL_CALL_START';
    toolCallId: string;
    toolCallName: string;
    parentMessageId?: string;
}) | (AgUiBaseEvent & {
    type: 'TOOL_CALL_ARGS';
    toolCallId: string;
    delta: string;
}) | (AgUiBaseEvent & {
    type: 'TOOL_CALL_END';
    toolCallId: string;
}) | (AgUiBaseEvent & {
    type: 'TOOL_CALL_RESULT';
    messageId: string;
    toolCallId: string;
    content: string;
    role: 'tool';
}) | (AgUiBaseEvent & {
    type: 'STATE_SNAPSHOT';
    snapshot: AgUiRunState;
}) | (AgUiBaseEvent & {
    type: 'STATE_DELTA';
    delta: JsonPatchOperation[];
});
export declare function parseAgUiRunRequest(body: unknown): {
    ok: true;
    input: AgUiRunRequest;
} | {
    ok: false;
    error: string;
};
export declare function toAgUiConceptInput(request: AgUiRunRequest, defaultWorkspace?: string): ConceptInput;
export declare function createAgUiConceptProjector(record: Pick<ConceptRecord, 'conceptId' | 'runId' | 'status' | 'currentPhase' | 'phases' | 'artifactRefs'>, request: AgUiRunRequest, opts?: {
    clock?: () => number;
}): {
    snapshot: (events: Iterable<LedgerEvent>) => AgUiEvent[];
    project: (event: LedgerEvent) => AgUiEvent[];
    isTerminal: () => boolean;
};
export declare function createAgUiEventStream(source: AsyncIterable<StreamEvent>, request: AgUiRunRequest, opts?: {
    clock?: () => number;
}): AsyncGenerator<AgUiEvent>;
export {};
//# sourceMappingURL=ag-ui.d.ts.map