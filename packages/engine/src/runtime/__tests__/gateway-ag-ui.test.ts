// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import { createRuntimeGateway } from '../gateway';
import type { ConceptHandle, ConceptRecord } from '../universal/engine-loop';
import type { StreamEvent } from '../streaming';

process.env['LOG_LEVEL'] = 'silent';

function makeConfig(port = 0): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port,
      bearerToken: undefined,
      bearerTokens: [],
    },
    rateLimit: {
      enabled: false,
      capacity: 60,
      refillPerSec: 1,
      exemptPaths: ['/ping'],
    },
    features: {
      universalEngine: true,
    },
  } as unknown as RuntimeConfig;
}

function parseSSE(raw: string): unknown[] {
  return raw
    .split(/\n\n+/)
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data: '))?.slice('data: '.length))
    .filter((line): line is string => typeof line === 'string')
    .map((line) => JSON.parse(line));
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (events: unknown[]) => boolean,
): Promise<unknown[]> {
  const decoder = new TextDecoder();
  let raw = '';
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((resolve) => setTimeout(() => resolve({ done: true }), remaining)),
    ]);
    if (result.done && !result.value) break;
    if (result.value) raw += decoder.decode(result.value, { stream: true });
    const events = parseSSE(raw);
    if (predicate(events)) return events;
  }
  return parseSSE(raw);
}

function makeRuntime(events: StreamEvent[]): PyrforRuntime {
  return {
    streamChatRequest: vi.fn().mockImplementation(async function* () {
      for (const event of events) yield event;
    }),
    handleMessage: vi.fn(),
  } as unknown as PyrforRuntime;
}

describe('POST /agent/run', () => {
  let gateway: ReturnType<typeof createRuntimeGateway> | null = null;

  afterEach(async () => {
    if (gateway) {
      await gateway.stop().catch(() => {});
      gateway = null;
    }
  });

  it('streams AG-UI events over SSE', async () => {
    const runtime = makeRuntime([
      { type: 'run', sessionId: 'sess-1', runId: 'runtime-run-1', taskId: 'task-1' },
      { type: 'token', text: 'Found 3 results' },
      { type: 'tool', name: 'search', args: { q: 'test' } },
      { type: 'tool_result', name: 'search', ok: true, result: { hits: 3 } },
      { type: 'final', text: 'Found 3 results' },
    ]);

    gateway = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gateway.start();

    const res = await fetch(`http://127.0.0.1:${gateway.port}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'search test',
        messages: [{ id: 'm1', role: 'user', content: 'search test' }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSSE(await res.text()) as Array<{ type: string }>;
    expect(events[0]?.type).toBe('RUN_STARTED');
    expect(events[1]?.type).toBe('STATE_SNAPSHOT');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'RUN_FINISHED',
    ]));
  });

  it('derives prompt text from user messages and threads it into the runtime call', async () => {
    const runtime = makeRuntime([{ type: 'final', text: 'ok' }]);
    gateway = createRuntimeGateway({ config: makeConfig(0), runtime, portOverride: 0 });
    await gateway.start();

    await fetch(`http://127.0.0.1:${gateway.port}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: 'thread-1',
        messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello from thread' }] }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    }).then((response) => response.text());

    expect(runtime.streamChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello from thread',
      sessionId: 'thread-1',
      signal: expect.any(AbortSignal),
    }));
  });

  it('dispatches concept mode through the universal engine instead of chat streaming', async () => {
    const runtime = makeRuntime([]);
    const listeners: Array<(event: unknown) => void> = [];
    let resolveRecord!: (record: ConceptRecord) => void;
    const completion = new Promise<ConceptRecord>((resolve) => {
      resolveRecord = resolve;
    });
    const record: ConceptRecord = {
      conceptId: 'concept-1',
      goal: 'hello from concept mode',
      runId: 'run-ue-1',
      status: 'queued',
      phases: [],
      artifactRefs: [],
      createdAt: '2026-05-15T00:00:00.000Z',
    };
    const handle: ConceptHandle = {
      conceptId: 'concept-1',
      runId: 'run-ue-1',
      status: () => 'queued',
      promise: () => completion,
      abort: () => {},
    };
    const orchestration = {
      universalEngine: {
        dispatchConcept: vi.fn(() => handle),
        getConceptRecord: vi.fn(() => record),
      },
      eventLedger: {
        readAll: vi.fn().mockResolvedValue([
          {
            id: 'evt-1',
            ts: '2026-05-15T00:00:00.000Z',
            run_id: 'run-ue-1',
            seq: 1,
            type: 'concept.received',
            concept_id: 'concept-1',
          },
        ]),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          listeners.push(listener);
          return () => {};
        }),
      },
    };

    gateway = createRuntimeGateway({
      config: makeConfig(0),
      runtime,
      orchestration: orchestration as any,
      portOverride: 0,
    });
    await gateway.start();

    const res = await fetch(`http://127.0.0.1:${gateway.port}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'concept',
        threadId: 'thread-1',
        messages: [{ id: 'm1', role: 'user', content: 'hello from concept mode' }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
        concept: {
          projectId: 'proj-1',
          strategies: ['governance-first'],
        },
      }),
    });

    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    try {
      const initialEvents = await readSseUntil(reader, (events) =>
        events.some((event) => (event as { type?: string }).type === 'STATE_SNAPSHOT')
      );
      expect(initialEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'RUN_STARTED' }),
        expect.objectContaining({
          type: 'STATE_SNAPSHOT',
          snapshot: expect.objectContaining({
            runtime: expect.objectContaining({
              conceptId: 'concept-1',
              currentPhase: 'plan',
            }),
          }),
        }),
      ]));

      listeners.forEach((listener) => listener({
        id: 'evt-2',
        ts: '2026-05-15T00:00:01.000Z',
        run_id: 'run-ue-1',
        seq: 2,
        type: 'concept.completed',
        concept_id: 'concept-1',
        status: 'done',
      }));
      resolveRecord({
        ...record,
        status: 'done',
        completedAt: '2026-05-15T00:00:02.000Z',
      });
      const finishEvents = await readSseUntil(reader, (events) =>
        events.some((event) => (event as { type?: string }).type === 'RUN_FINISHED')
      );
      expect(finishEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'RUN_FINISHED',
          outcome: { type: 'success' },
          result: expect.objectContaining({ conceptId: 'concept-1' }),
        }),
      ]));
    } finally {
      await reader.cancel().catch(() => {});
    }

    expect(orchestration.universalEngine.dispatchConcept).toHaveBeenCalledWith(expect.objectContaining({
      goal: 'hello from concept mode',
      projectId: 'proj-1',
      strategies: ['governance-first'],
    }));
    expect(runtime.streamChatRequest).not.toHaveBeenCalled();
  });

  it('falls back to concept handle completion when no event ledger is available', async () => {
    const runtime = makeRuntime([]);
    const initialRecord: ConceptRecord = {
      conceptId: 'concept-2',
      goal: 'finish without ledger',
      runId: 'run-ue-2',
      status: 'queued',
      phases: [],
      artifactRefs: [{ id: 'artifact-1', kind: 'summary', uri: 'artifact://summary/1', sha256: 'abc123' }],
      createdAt: '2026-05-15T00:00:00.000Z',
    };
    const finalRecord: ConceptRecord = {
      ...initialRecord,
      status: 'done',
      completedAt: '2026-05-15T00:00:05.000Z',
    };
    const orchestration = {
      universalEngine: {
        dispatchConcept: vi.fn((): ConceptHandle => ({
          conceptId: 'concept-2',
          runId: 'run-ue-2',
          status: () => 'queued',
          promise: async () => finalRecord,
          abort: () => {},
        })),
        getConceptRecord: vi.fn(() => initialRecord),
      },
    };

    gateway = createRuntimeGateway({
      config: makeConfig(0),
      runtime,
      orchestration: orchestration as any,
      portOverride: 0,
    });
    await gateway.start();

    const res = await fetch(`http://127.0.0.1:${gateway.port}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'concept',
        text: 'finish without ledger',
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });

    expect(res.status).toBe(200);
    const events = parseSSE(await res.text()) as Array<{ type: string }>;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'RUN_STARTED' }),
      expect.objectContaining({ type: 'STATE_SNAPSHOT' }),
      expect.objectContaining({
        type: 'RUN_FINISHED',
        outcome: { type: 'success' },
        result: expect.objectContaining({ artifactIds: ['artifact-1'] }),
      }),
    ]));
    expect(runtime.streamChatRequest).not.toHaveBeenCalled();
  });
});
