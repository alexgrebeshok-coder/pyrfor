// @vitest-environment node
/**
 * Integration test: universal tool-call parser end-to-end through runToolLoop.
 *
 * Exercises the full pipeline:
 *   stub LLM provider → multi-format tool-call output → parser → exec → final answer.
 *
 * Validates that all of the formats supported by the new tool-call-parser module
 * are recognised when emitted by a model and reach the executor without surfacing
 * SyntaxError or being silently dropped.
 */
import { describe, it, expect, vi } from 'vitest';
import { runToolLoop, type ChatFn, type ToolExecFn } from '../tool-loop';
import { parseToolCalls } from '../tool-call-parser';
import type { ToolDefinition } from '../tools';
import type { Message } from '../../ai/providers/base';

vi.mock('../../observability/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const webSearch: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
};

describe('parser ↔ runtime integration', () => {
  it('runToolLoop drives multi-format tool-call sequence to completion', async () => {
    const responses = [
      // 1. canonical JSON inside <tool_call>
      `<tool_call>{"name":"web_search","arguments":{"query":"alpha"}}</tool_call>`,
      // 2. Zhipu-style arg_key/arg_value XML inside <tool_call>
      `<tool_call>web_search<arg_key>query</arg_key><arg_value>beta</arg_value></tool_call>`,
      // 3. bare top-level OpenAI-shaped object (no wrapper, no fence)
      `{"name":"web_search","arguments":{"query":"gamma"}}`,
      // 4. final assistant turn with no tool call → loop ends
      `Готово.`,
    ];

    let i = 0;
    const chat: ChatFn = vi.fn(async () => responses[i++]);
    const exec: ToolExecFn = vi.fn(async (name, args) => ({
      ok: true,
      data: { name, q: (args as { query: string }).query },
    }));

    const messages: Message[] = [{ role: 'user', content: 'do work' }];
    const result = await runToolLoop(messages, [webSearch], chat, exec, undefined);

    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls.map((c) => c.call.args.query)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(result.toolCalls.every((c) => c.result.ok)).toBe(true);
    expect(result.finalText).toBe('Готово.');
    expect(result.truncated).toBe(false);
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('parser tolerates fenced ```json``` and Anthropic-style <function_call> tags', async () => {
    const fenced = '```json\n{"name":"web_search","arguments":{"query":"fenced"}}\n```';
    const fnTag = `<function_call>{"name":"web_search","arguments":{"query":"fc"}}</function_call>`;

    expect(parseToolCalls(fenced).map((c) => c.args.query)).toEqual(['fenced']);
    expect(parseToolCalls(fnTag).map((c) => c.args.query)).toEqual(['fc']);
  });

  it('garbage input returns [] without throwing', () => {
    expect(parseToolCalls('definitely not a tool call, just prose.')).toEqual([]);
    expect(parseToolCalls('<tool_call>{not json at all}</tool_call>')).toEqual([]);
  });
});
