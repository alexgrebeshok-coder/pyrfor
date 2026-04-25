// @vitest-environment node
/**
 * Tests for runtime/streaming.ts — handleMessageStream async generator.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleMessageStream, buildContextBlock, type StreamEvent, type OpenFile } from '../streaming';
import type { Message } from '../../ai/providers/base';
import type { ChatFn, ToolExecFn } from '../tool-loop';

// Silence logger
process.env['LOG_LEVEL'] = 'silent';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function makeMessages(text: string): Message[] {
  return [{ role: 'user', content: text }];
}

// ─── buildContextBlock ────────────────────────────────────────────────────────

describe('buildContextBlock', () => {
  it('wraps files in context_files XML', () => {
    const files: OpenFile[] = [
      { path: 'src/a.ts', content: 'const x = 1;', language: 'typescript' },
      { path: 'src/b.ts', content: 'const y = 2;' },
    ];
    const block = buildContextBlock(files);
    expect(block).toContain('<context_files>');
    expect(block).toContain('</context_files>');
    expect(block).toContain('<file path="src/a.ts" lang="typescript">const x = 1;</file>');
    expect(block).toContain('<file path="src/b.ts" lang="">const y = 2;</file>');
    expect(block).not.toContain('… [truncated]');
  });

  it('truncates and appends marker when combined content exceeds 64 KB', () => {
    const big = 'x'.repeat(40 * 1024); // 40 KB each
    const files: OpenFile[] = [
      { path: 'a.txt', content: big },
      { path: 'b.txt', content: big }, // this one would push us over 64 KB
    ];
    const block = buildContextBlock(files);
    expect(block).toContain('… [truncated]');
    expect(block).toContain('a.txt');
    expect(block).not.toContain('b.txt'); // second file truncated
  });
});

// ─── handleMessageStream — basic token flow ───────────────────────────────────

describe('handleMessageStream — token flow', () => {
  it('(a) yields tokens in order for a single-turn response', async () => {
    const chat: ChatFn = vi.fn().mockResolvedValueOnce('Hello world');
    const messages = makeMessages('Hi');

    const events = await collect(handleMessageStream(messages, { chat }));

    // Token followed by final
    expect(events[0]).toEqual({ type: 'token', text: 'Hello world' });
    const finalEvt = events.find((e) => e.type === 'final');
    expect(finalEvt).toBeDefined();
    expect((finalEvt as { type: 'final'; text: string }).text).toBe('Hello world');
  });

  it('emits tokens in order for multiple LLM turns (no tools)', async () => {
    const chat: ChatFn = vi.fn()
      .mockResolvedValueOnce('First turn')
      .mockResolvedValueOnce('Second turn');
    const messages = makeMessages('multi-turn test');

    // Only one turn because no tool calls in responses
    const events = await collect(handleMessageStream(messages, { chat }));

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect((tokens[0] as { type: 'token'; text: string }).text).toBe('First turn');
  });

  it('(c) final event has the accumulated (stripped) text', async () => {
    const chat: ChatFn = vi.fn().mockResolvedValueOnce('The answer is 42');
    const messages = makeMessages('What is the answer?');

    const events = await collect(handleMessageStream(messages, { chat }));

    const finalEvt = events.find((e) => e.type === 'final') as { type: 'final'; text: string } | undefined;
    expect(finalEvt).toBeDefined();
    expect(finalEvt!.text).toBe('The answer is 42');
  });
});

// ─── handleMessageStream — tool events ────────────────────────────────────────

describe('handleMessageStream — tool events', () => {
  it('(b) tool events appear before the final event', async () => {
    // First LLM call returns a tool_call block; second returns the final answer.
    const chat: ChatFn = vi.fn()
      .mockResolvedValueOnce(
        'Let me look it up.\n<tool_call>{"name":"noop","args":{"q":"test"}}</tool_call>',
      )
      .mockResolvedValueOnce('The result is: 42');

    const exec: ToolExecFn = vi.fn().mockResolvedValue({ success: true, data: { answer: 42 } });

    const messages = makeMessages('tool test');
    const events = await collect(
      handleMessageStream(messages, {
        chat,
        exec,
        tools: [
          {
            name: 'noop',
            description: 'no-op test tool',
            parameters: { type: 'object', properties: { q: { type: 'string' } }, required: [] },
          },
        ],
      }),
    );

    const types = events.map((e) => e.type);
    const finalIdx = types.lastIndexOf('final');
    const toolIdx = types.indexOf('tool');
    const toolResultIdx = types.indexOf('tool_result');

    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(toolResultIdx).toBeGreaterThan(toolIdx); // result after call
    expect(finalIdx).toBeGreaterThan(toolResultIdx); // final after result
  });

  it('emits tool name and args in the tool event', async () => {
    const chat: ChatFn = vi.fn()
      .mockResolvedValueOnce(
        '<tool_call>{"name":"greet","args":{"name":"Alice"}}</tool_call>',
      )
      .mockResolvedValueOnce('Done');

    const exec: ToolExecFn = vi.fn().mockResolvedValue({ success: true, data: {} });

    const messages = makeMessages('call greet');
    const events = await collect(
      handleMessageStream(messages, {
        chat,
        exec,
        tools: [
          {
            name: 'greet',
            description: 'greet a person',
            parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          },
        ],
      }),
    );

    const toolEvt = events.find((e) => e.type === 'tool') as
      | { type: 'tool'; name: string; args: Record<string, unknown> }
      | undefined;
    expect(toolEvt).toBeDefined();
    expect(toolEvt!.name).toBe('greet');
    expect(toolEvt!.args).toEqual({ name: 'Alice' });
  });

  it('emits tool_result with data from exec', async () => {
    const chat: ChatFn = vi.fn()
      .mockResolvedValueOnce(
        '<tool_call>{"name":"calc","args":{"x":2}}</tool_call>',
      )
      .mockResolvedValueOnce('Result is 4');

    const exec: ToolExecFn = vi.fn().mockResolvedValue({ success: true, data: { value: 4 } });

    const messages = makeMessages('calc');
    const events = await collect(
      handleMessageStream(messages, {
        chat,
        exec,
        tools: [
          {
            name: 'calc',
            description: 'calc',
            parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
          },
        ],
      }),
    );

    const resultEvt = events.find((e) => e.type === 'tool_result') as
      | { type: 'tool_result'; name: string; result: unknown }
      | undefined;
    expect(resultEvt).toBeDefined();
    expect(resultEvt!.name).toBe('calc');
    expect(resultEvt!.result).toEqual({ value: 4 });
  });
});

// ─── handleMessageStream — final is always last ───────────────────────────────

describe('handleMessageStream — final is last', () => {
  it('final event is always the last event emitted', async () => {
    const chat: ChatFn = vi.fn().mockResolvedValueOnce('Simple answer');
    const messages = makeMessages('q');
    const events = await collect(handleMessageStream(messages, { chat }));

    expect(events[events.length - 1]?.type).toBe('final');
  });
});
