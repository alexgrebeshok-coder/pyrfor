// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createAgUiEventStream, parseAgUiRunRequest, type AgUiEvent } from './ag-ui.js';
import type { StreamEvent } from './streaming.js';

async function collect(stream: AsyncIterable<AgUiEvent>): Promise<AgUiEvent[]> {
  const events: AgUiEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('parseAgUiRunRequest', () => {
  it('extracts prompt text from the latest user multimodal message when text is omitted', () => {
    const parsed = parseAgUiRunRequest({
      threadId: 'thread-1',
      messages: [
        { id: 'm1', role: 'assistant', content: 'prior' },
        { id: 'm2', role: 'user', content: [{ type: 'text', text: 'hello from multimodal' }] },
      ],
      state: { ready: true },
      tools: [],
      context: [],
      forwardedProps: {},
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.promptText).toBe('hello from multimodal');
    expect(parsed.input.threadId).toBe('thread-1');
  });
});

describe('createAgUiEventStream', () => {
  it('maps runtime stream events into AG-UI lifecycle, text, tool, state, and finish events', async () => {
    async function* source(): AsyncGenerator<StreamEvent> {
      yield { type: 'run', sessionId: 'sess-1', runId: 'runtime-run-1', taskId: 'task-1' };
      yield { type: 'token', text: 'Planning search' };
      yield { type: 'tool', name: 'search', args: { q: 'test' } };
      yield { type: 'tool_result', name: 'search', ok: true, result: { hits: 3 } };
      yield { type: 'token', text: 'Found 3 results' };
      yield { type: 'final', text: 'Found 3 results' };
    }

    const events = await collect(createAgUiEventStream(source(), {
      state: {},
      messages: [{ id: 'user-1', role: 'user', content: 'search test' }],
      tools: [],
      context: [],
      forwardedProps: {},
      promptText: 'search test',
    }, { clock: () => 123 }));

    expect(events[0]).toMatchObject({
      type: 'RUN_STARTED',
      threadId: 'sess-1',
      runId: 'runtime-run-1',
    });
    expect(events[1]).toMatchObject({ type: 'STATE_SNAPSHOT' });
    expect(events.filter((event) => event.type === 'TEXT_MESSAGE_START')).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'TOOL_CALL_START', toolCallName: 'search' }),
      expect.objectContaining({ type: 'TOOL_CALL_ARGS', delta: '{"q":"test"}' }),
      expect.objectContaining({ type: 'TOOL_CALL_END' }),
      expect.objectContaining({ type: 'TOOL_CALL_RESULT', role: 'tool', content: '{"hits":3}' }),
      expect.objectContaining({ type: 'RUN_FINISHED', outcome: { type: 'success' } }),
    ]));
    const finished = events.find((event) => event.type === 'RUN_FINISHED');
    expect(finished).toMatchObject({
      type: 'RUN_FINISHED',
      result: { text: 'Found 3 results' },
    });
  });

  it('emits an interrupt-aware RunFinished outcome when upstream surfaces interrupts', async () => {
    async function* source(): AsyncGenerator<StreamEvent> {
      throw {
        message: 'approval required',
        interrupts: [{
          id: 'int-1',
          reason: 'tool_call',
          message: 'Approve search?',
          toolCallId: 'tc-1',
        }],
      };
      yield { type: 'final', text: 'unused' };
    }

    const events = await collect(createAgUiEventStream(source(), {
      threadId: 'thread-1',
      state: {},
      messages: [{ id: 'user-1', role: 'user', content: 'search test' }],
      tools: [],
      context: [],
      forwardedProps: {},
      promptText: 'search test',
    }));

    expect(events[0]).toMatchObject({ type: 'RUN_STARTED', threadId: 'thread-1' });
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      outcome: {
        type: 'interrupt',
        interrupts: [expect.objectContaining({ id: 'int-1', reason: 'tool_call' })],
      },
    });
  });

  it('matches out-of-order same-name tool results by toolCallId', async () => {
    async function* source(): AsyncGenerator<StreamEvent> {
      yield { type: 'tool', toolCallId: 'tc-1', name: 'search', args: { q: 'A' } };
      yield { type: 'tool', toolCallId: 'tc-2', name: 'search', args: { q: 'B' } };
      yield { type: 'tool_result', toolCallId: 'tc-2', name: 'search', ok: true, result: { query: 'B' } };
      yield { type: 'tool_result', toolCallId: 'tc-1', name: 'search', ok: true, result: { query: 'A' } };
      yield { type: 'final', text: 'done' };
    }

    const events = await collect(createAgUiEventStream(source(), {
      threadId: 'thread-1',
      state: {},
      messages: [{ id: 'user-1', role: 'user', content: 'search twice' }],
      tools: [],
      context: [],
      forwardedProps: {},
      promptText: 'search twice',
    }));

    const toolResults = events.filter((event) => event.type === 'TOOL_CALL_RESULT');
    expect(toolResults).toEqual([
      expect.objectContaining({ toolCallId: 'tc-2', content: '{"query":"B"}' }),
      expect.objectContaining({ toolCallId: 'tc-1', content: '{"query":"A"}' }),
    ]);
  });
});
