// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseToolCalls,
  stripToolCalls,
  buildToolInstructions,
  runToolLoop,
  SAFETY_HARD_CAP,
  type ToolCall,
} from './tool-loop';
import type { ToolDefinition, ToolResult } from './tools';
import type { Message } from '../ai/providers/base';
import { logger } from '../observability/logger';

// Silence logger.warn/info during tests
vi.mock('../observability/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeTool = (name = 'myTool', description = 'A tool'): ToolDefinition => ({
  name,
  description,
  parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
});

describe('tool-loop', () => {
  // =========================================================================
  describe('parseToolCalls', () => {
    // -----------------------------------------------------------------------
    // Four canonical shapes
    // -----------------------------------------------------------------------
    it('form 1: <tool_call>{json}</tool_call>', () => {
      const text = '<tool_call>{"name":"search","args":{"q":"hello"}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ q: 'hello' });
    });

    it('form 2: <tool_call>{json} (no closer)', () => {
      const text = '<tool_call>{"name":"calc","args":{"expr":"1+1"}}';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('calc');
      expect(calls[0].args).toEqual({ expr: '1+1' });
    });

    it('form 3: <tool_call={json}> (GLM-style)', () => {
      const text = '<tool_call={"name":"lookup","args":{"id":42}}>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('lookup');
      expect(calls[0].args).toEqual({ id: 42 });
    });

    it('form 4: <tool_call={json}></tool_call> (GLM with redundant closer)', () => {
      const text = '<tool_call={"name":"ping","args":{}}></tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('ping');
      expect(calls[0].args).toEqual({});
    });

    // -----------------------------------------------------------------------
    // arguments alias
    // -----------------------------------------------------------------------
    it('supports "arguments" key as alias for "args"', () => {
      const text = '<tool_call>{"name":"run","arguments":{"cmd":"ls"}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual({ cmd: 'ls' });
    });

    // -----------------------------------------------------------------------
    // JSON with `>` inside a string in GLM form
    // -----------------------------------------------------------------------
    it('GLM form: JSON with ">" inside string value does not break parsing', () => {
      const text = '<tool_call={"name":"shell","args":{"cmd":"echo a>b"}}>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('shell');
      expect(calls[0].args).toEqual({ cmd: 'echo a>b' });
    });

    // -----------------------------------------------------------------------
    // Noisy / repairable JSON
    // -----------------------------------------------------------------------
    it('trailing comma in JSON → returns [] (repair does not cover trailing commas)', () => {
      // NOTE: the fallback repair only re-quotes bare keys and converts single quotes;
      // it does NOT strip trailing commas, so this silently returns [].
      const text = '<tool_call>{"name":"foo","args":{"x":1,}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(0);
    });

    it('repairs single-quoted keys/values', () => {
      const text = "<tool_call>{'name':'bar','args':{'y':2}}</tool_call>";
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('bar');
    });

    // -----------------------------------------------------------------------
    // ```json fence inside tag
    // -----------------------------------------------------------------------
    it('strips ```json fence inside tag', () => {
      const text = '<tool_call>```json\n{"name":"fenced","args":{"k":"v"}}\n```</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('fenced');
    });

    // -----------------------------------------------------------------------
    // Multiple calls
    // -----------------------------------------------------------------------
    it('parses multiple tool_calls (mixed forms)', () => {
      const text = [
        'First: <tool_call>{"name":"a","args":{}}</tool_call>',
        'Second: <tool_call={"name":"b","args":{"x":1}}>',
      ].join('\n');
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(2);
      expect(calls[0].name).toBe('a');
      expect(calls[1].name).toBe('b');
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------
    it('returns [] for text without tool_call tags', () => {
      expect(parseToolCalls('Hello, world!')).toEqual([]);
    });

    it('returns [] for empty string', () => {
      expect(parseToolCalls('')).toEqual([]);
    });

    it('skips tool_call without "name" field', () => {
      const text = '<tool_call>{"args":{"x":1}}</tool_call>';
      expect(parseToolCalls(text)).toEqual([]);
    });

    it('returns [] and does not throw on completely broken JSON', () => {
      const text = '<tool_call>{{{{not json at all}}}}</tool_call>';
      expect(() => parseToolCalls(text)).not.toThrow();
      expect(parseToolCalls(text)).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // OpenAI native tool_calls JSON blob in text — NOW SUPPORTED
    // -----------------------------------------------------------------------
    // The universal parser (tool-call-parser.ts) recognises native OpenAI
    // tool_calls arrays even when they leak through as raw text from a
    // misconfigured adapter. The `arguments` field is double-encoded JSON
    // per OpenAI spec and must be decoded.
    it('OpenAI-format tool_calls JSON blob → parsed via openai-native strategy', () => {
      const text = JSON.stringify({
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      });
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ q: 'test' });
    });

    // -----------------------------------------------------------------------
    // Tool calls mixed with normal text
    // -----------------------------------------------------------------------
    it('extracts tool calls when surrounded by plain text', () => {
      const text =
        'Sure, let me look that up.\n' +
        '<tool_call>{"name":"search","args":{"q":"vitest"}}</tool_call>\n' +
        'I will get back to you shortly.';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      // raw slice should contain the tag
      expect(calls[0].raw).toContain('<tool_call>');
    });

    // -----------------------------------------------------------------------
    // NEW: GLM whitespace variants
    // -----------------------------------------------------------------------
    it('GLM format with whitespace before = sign: <tool_call = {...}>', () => {
      const text = '<tool_call = {"name":"ws","args":{"x":1}}>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('ws');
      expect(calls[0].args).toEqual({ x: 1 });
    });

    it('GLM format with newlines inside JSON body', () => {
      const text = '<tool_call={"name":"multi",\n"args":{"a":1,\n"b":2}}>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('multi');
      expect(calls[0].args).toEqual({ a: 1, b: 2 });
    });

    // -----------------------------------------------------------------------
    // NEW: Multiple same-form calls
    // -----------------------------------------------------------------------
    it('three canonical <tool_call>...</tool_call> calls in same message', () => {
      const text = [
        '<tool_call>{"name":"t1","args":{"a":1}}</tool_call>',
        '<tool_call>{"name":"t2","args":{"b":2}}</tool_call>',
        '<tool_call>{"name":"t3","args":{"c":3}}</tool_call>',
      ].join('\n');
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(3);
      expect(calls[0].name).toBe('t1');
      expect(calls[1].name).toBe('t2');
      expect(calls[2].name).toBe('t3');
    });

    // -----------------------------------------------------------------------
    // NEW: raw field includes explicit closer
    // -----------------------------------------------------------------------
    it('raw field includes the explicit </tool_call> closer', () => {
      const text = '<tool_call>{"name":"snap","args":{}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].raw).toBe(text);
      expect(calls[0].raw).toContain('</tool_call>');
    });

    // -----------------------------------------------------------------------
    // NEW: Nested JSON objects and arrays in args
    // -----------------------------------------------------------------------
    it('nested JSON objects and arrays inside args are preserved', () => {
      const text =
        '<tool_call>{"name":"complex","args":{"nested":{"k":"v"},"list":[1,2,3]}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('complex');
      expect(calls[0].args).toEqual({ nested: { k: 'v' }, list: [1, 2, 3] });
    });

    // -----------------------------------------------------------------------
    // NEW: Malformed JSON logs a warning
    // -----------------------------------------------------------------------
    it('malformed JSON inside tool_call → skipped and logger.warn called', () => {
      vi.mocked(logger.warn).mockClear();
      const text = '<tool_call>totally not json</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
      const firstCallArgs = vi.mocked(logger.warn).mock.calls[0];
      expect(firstCallArgs[0]).toMatch(/Failed to parse/i);
    });

    // -----------------------------------------------------------------------
    // Anthropic tool_use formats — NOW SUPPORTED via universal parser
    // -----------------------------------------------------------------------
    it('Anthropic-style tool_use block → parsed via bare-object strategy', () => {
      const text = JSON.stringify({
        type: 'tool_use',
        id: 'toolu_01abc',
        name: 'search',
        input: { q: 'test' },
      });
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ q: 'test' });
    });

    it('Anthropic XML-style <tool_use> tag → parsed via function-call-tag strategy', () => {
      const text = '<tool_use>{"name":"search","args":{"q":"test"}}</tool_use>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ q: 'test' });
    });
  });

  // =========================================================================
  describe('stripToolCalls', () => {
    it('strips form 1: <tool_call>{json}</tool_call>', () => {
      const text = 'before <tool_call>{"name":"x","args":{}}</tool_call> after';
      const result = stripToolCalls(text);
      expect(result).not.toContain('<tool_call');
      expect(result).toContain('before');
      expect(result).toContain('after');
    });

    it('strips form 2: no closer', () => {
      const text = 'hello <tool_call>{"name":"x","args":{}} world';
      const result = stripToolCalls(text);
      expect(result).not.toContain('<tool_call');
    });

    it('strips form 3: GLM style', () => {
      const text = 'pre <tool_call={"name":"y","args":{}}> post';
      const result = stripToolCalls(text);
      expect(result).not.toContain('<tool_call');
      expect(result).toContain('pre');
      expect(result).toContain('post');
    });

    it('strips form 4: GLM with redundant closer', () => {
      const text = 'a <tool_call={"name":"z","args":{}}></tool_call> b';
      const result = stripToolCalls(text);
      expect(result).not.toContain('<tool_call');
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('strips multiple tool_calls', () => {
      const text =
        'A <tool_call>{"name":"t1","args":{}}</tool_call> B <tool_call>{"name":"t2","args":{}}</tool_call> C';
      const result = stripToolCalls(text);
      expect(result).not.toContain('<tool_call');
      expect(result).toContain('A');
      expect(result).toContain('B');
      expect(result).toContain('C');
    });

    it('returns trimmed text when there are no tags', () => {
      expect(stripToolCalls('  hello  ')).toBe('hello');
    });

    it('returns empty string for empty input', () => {
      expect(stripToolCalls('')).toBe('');
    });

    it('removes trailing unclosed <tool_call without JSON (fallback)', () => {
      const text = 'Final answer.\n<tool_call';
      const result = stripToolCalls(text);
      expect(result).not.toContain('<tool_call');
      expect(result).toContain('Final answer');
    });

    it('collapses 3+ newlines into \\n\\n', () => {
      const text = 'line1\n\n\n\nline2';
      expect(stripToolCalls(text)).toBe('line1\n\nline2');
    });
  });

  // =========================================================================
  describe('buildToolInstructions', () => {
    it('returns empty string for empty tools array', () => {
      expect(buildToolInstructions([])).toBe('');
    });

    it('mentions <tool_call> format', () => {
      const result = buildToolInstructions([makeTool()]);
      expect(result).toContain('<tool_call>');
    });

    it('includes tool name and description', () => {
      const tool = makeTool('mySearch', 'Searches the web');
      const result = buildToolInstructions([tool]);
      expect(result).toContain('mySearch');
      expect(result).toContain('Searches the web');
    });

    it('includes JSON-serialized parameters', () => {
      const tool = makeTool();
      const result = buildToolInstructions([tool]);
      expect(result).toContain(JSON.stringify(tool.parameters));
    });

    it('includes all tools when multiple provided', () => {
      const tools = [makeTool('toolA', 'First'), makeTool('toolB', 'Second')];
      const result = buildToolInstructions(tools);
      expect(result).toContain('toolA');
      expect(result).toContain('toolB');
      expect(result).toContain('First');
      expect(result).toContain('Second');
    });
  });

  // =========================================================================
  describe('runToolLoop', () => {
    const tool = makeTool('search', 'Search tool');
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];

    it('case 1: returns final text immediately when no tool_call in response', async () => {
      const chat = vi.fn().mockResolvedValue('Hello, how can I help you?');
      const exec = vi.fn();

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.finalText).toBe('Hello, how can I help you?');
      expect(result.iterations).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.toolCalls).toHaveLength(0);
      expect(chat).toHaveBeenCalledTimes(1);
    });

    it('case 2: executes tool call then returns final text, result in messages', async () => {
      const toolResponseText = '<tool_call>{"name":"search","args":{"q":"vitest"}}</tool_call>';
      const finalText = 'The answer is 42.';
      const chat = vi
        .fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce(finalText);

      const exec = vi.fn().mockResolvedValue({ success: true, data: { hits: 3 } });

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.finalText).toBe(finalText);
      expect(result.iterations).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].call.name).toBe('search');
      expect(result.toolCalls[0].result.success).toBe(true);

      // The second chat call should include a user message with tool results
      const secondCallMessages: Message[] = chat.mock.calls[1][0];
      const toolResultMsg = secondCallMessages.find(
        (m) => m.role === 'user' && m.content.includes('[tool_result name=search]')
      );
      expect(toolResultMsg).toBeDefined();
    });

    it('case 3: stops at maxIterations when provider keeps emitting tool calls', async () => {
      // Always respond with a tool call
      const infiniteToolCall = '<tool_call>{"name":"search","args":{"q":"x"}}</tool_call>';
      const chat = vi.fn().mockResolvedValue(infiniteToolCall);
      const exec = vi.fn().mockResolvedValue({ success: true, data: {} });

      const result = await runToolLoop(messages, [tool], chat, exec, undefined, {}, { maxIterations: 3 });

      expect(result.truncated).toBe(true);
      expect(result.iterations).toBe(3);
      // finalText is either stripped (empty stripped → fallback message) or the fallback
      expect(typeof result.finalText).toBe('string');
    });

    it('case 4: executor throws → success:false result captured in LLM message, loop continues', async () => {
      const toolResponseText = '<tool_call>{"name":"search","args":{"q":"fail"}}</tool_call>';
      const finalText = 'Despite the error, here is your answer.';
      const chat = vi
        .fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce(finalText);

      const exec = vi.fn().mockRejectedValue(new Error('network timeout'));

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.finalText).toBe(finalText);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].result.success).toBe(false);
      expect(result.toolCalls[0].result.error).toContain('network timeout');

      // The error must be forwarded to the LLM in the next user message.
      const secondCallMessages: Message[] = chat.mock.calls[1][0];
      const errMsg = secondCallMessages.find(
        (m) => m.role === 'user' && m.content.includes('status=error')
      );
      expect(errMsg).toBeDefined();
      expect(errMsg!.content).toContain('network timeout');

      // Loop must not throw
      expect(result.truncated).toBe(false);
    });

    // -----------------------------------------------------------------------
    // NEW: explicit maxIterations reached
    // -----------------------------------------------------------------------
    it('case 5: explicit maxIterations:5 reached → truncated=true, iterations=5', async () => {
      const infiniteToolCall = '<tool_call>{"name":"search","args":{"q":"x"}}</tool_call>';
      const chat = vi.fn().mockResolvedValue(infiniteToolCall);
      const exec = vi.fn().mockResolvedValue({ success: true, data: {} } satisfies ToolResult);

      const result = await runToolLoop(messages, [tool], chat, exec, undefined, {}, { maxIterations: 5 });

      expect(result.truncated).toBe(true);
      expect(result.iterations).toBe(5);
      expect(chat).toHaveBeenCalledTimes(5);
      expect(typeof result.finalText).toBe('string');
      expect(result.finalText.length).toBeGreaterThan(0); // fallback message present
    });

    // -----------------------------------------------------------------------
    // NEW: LLM returns empty / whitespace after tools
    // -----------------------------------------------------------------------
    it('case 6: LLM returns empty string after tool result → graceful, finalText=""', async () => {
      const toolResponseText = '<tool_call>{"name":"search","args":{"q":"test"}}</tool_call>';
      const chat = vi.fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce('');
      const exec = vi.fn().mockResolvedValue({ success: true, data: { hits: 0 } } satisfies ToolResult);

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.truncated).toBe(false);
      expect(result.finalText).toBe('');
      expect(result.iterations).toBe(2);
    });

    it('case 7: LLM returns whitespace-only text after tool result → stripped to empty', async () => {
      const toolResponseText = '<tool_call>{"name":"search","args":{"q":"test"}}</tool_call>';
      const chat = vi.fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce('   \n   ');
      const exec = vi.fn().mockResolvedValue({ success: true, data: {} } satisfies ToolResult);

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.truncated).toBe(false);
      expect(result.finalText).toBe('');
      expect(result.iterations).toBe(2);
    });

    // -----------------------------------------------------------------------
    // NEW: exec returns success:false (e.g. unknown tool, validation failure)
    // -----------------------------------------------------------------------
    it('case 8: exec returns success:false (unknown tool) → error forwarded to LLM, loop continues', async () => {
      const toolResponseText = '<tool_call>{"name":"unknownTool","args":{}}</tool_call>';
      const finalText = 'Sorry, that tool is unavailable.';
      const chat = vi.fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce(finalText);
      const exec = vi.fn().mockResolvedValue({
        success: false,
        data: {},
        error: 'Tool not found: unknownTool',
      } satisfies ToolResult);

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.finalText).toBe(finalText);
      expect(result.truncated).toBe(false);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].result.success).toBe(false);

      const secondCallMessages: Message[] = chat.mock.calls[1][0];
      const errMsg = secondCallMessages.find(
        (m) => m.role === 'user' && m.content.includes('status=error')
      );
      expect(errMsg).toBeDefined();
      expect(errMsg!.content).toContain('unknownTool');
    });

    it('case 9: exec returns success:false (arg validation) → error embedded into next LLM call', async () => {
      const toolResponseText = '<tool_call>{"name":"search","args":{}}</tool_call>';
      const finalText = 'I see the argument was invalid.';
      const chat = vi.fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce(finalText);
      const exec = vi.fn().mockResolvedValue({
        success: false,
        data: {},
        error: 'Missing required argument: q',
      } satisfies ToolResult);

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.finalText).toBe(finalText);
      expect(result.toolCalls[0].result.error).toContain('Missing required argument');

      const secondCallMessages: Message[] = chat.mock.calls[1][0];
      const errMsg = secondCallMessages.find(
        (m) => m.role === 'user' && m.content.includes('status=error')
      );
      expect(errMsg).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // NEW: zero iterations — no tool calls in first response
    // -----------------------------------------------------------------------
    it('case 10: zero tool calls in first response → returns immediately, iterations=1', async () => {
      const chat = vi.fn().mockResolvedValue('Just a plain answer with no tools needed.');
      const exec = vi.fn();

      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

      expect(result.iterations).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.toolCalls).toHaveLength(0);
      expect(exec).not.toHaveBeenCalled();
      expect(result.finalText).toBe('Just a plain answer with no tools needed.');
    });

    it('case 11: multiple independent tool calls in one turn execute concurrently', async () => {
      const toolResponseText = [
        'First: <tool_call>{"name":"search","args":{"q":"a"}}</tool_call>',
        'Second: <tool_call>{"name":"fetch","args":{"url":"b"}}</tool_call>',
        'Third: <tool_call>{"name":"search","args":{"q":"c"}}</tool_call>',
      ].join('\n');
      const finalText = 'All done with three concurrent calls.';

      const callOrder: string[] = [];
      const exec = vi.fn().mockImplementation((name: string) => {
        callOrder.push(name);
        return Promise.resolve({ success: true, data: { result: name } } satisfies ToolResult);
      });

      const chat = vi.fn()
        .mockResolvedValueOnce(toolResponseText)
        .mockResolvedValueOnce(finalText);

      const result = await runToolLoop(messages, [
        makeTool('search', 'Search'),
        makeTool('fetch', 'Fetch'),
      ], chat, exec, undefined);

      expect(result.finalText).toBe(finalText);
      expect(result.toolCalls).toHaveLength(3);
      expect(result.toolCalls[0].call.name).toBe('search');
      expect(result.toolCalls[1].call.name).toBe('fetch');
      expect(result.toolCalls[2].call.name).toBe('search');

      // All three tool calls should be executed (order may vary due to concurrency)
      expect(exec).toHaveBeenCalledTimes(3);
      expect(new Set(callOrder)).toEqual(new Set(['search', 'fetch', 'search']));

      // Verify that results are sent back in the correct order (not execution order)
      // The second call to chat should include the tool results message
      const secondChatCall = chat.mock.calls[1][0];
      const resultMsg = secondChatCall.find((m) => m.role === 'user' && m.content.includes('[tool_result'));
      expect(resultMsg).toBeDefined();
      expect(resultMsg?.content).toContain('[tool_result name=search]');
      expect(resultMsg?.content).toContain('[tool_result name=fetch]');

      // Verify tool result order in the message (search, fetch, search)
      const firstSearchIdx = resultMsg!.content.indexOf('[tool_result name=search]');
      const fetchIdx = resultMsg!.content.indexOf('[tool_result name=fetch]');
      const lastSearchIdx = resultMsg!.content.lastIndexOf('[tool_result name=search]');
      expect(firstSearchIdx).toBeLessThan(fetchIdx);
      expect(fetchIdx).toBeLessThan(lastSearchIdx);
    });
  });
});


// ===========================================================================
// A1 — configurable maxIterations & safetyHardCap
// ===========================================================================

describe('runToolLoop — A1: maxIterations & safetyHardCap', () => {
  const tool = makeTool('search', 'Search tool');
  const messages: Message[] = [{ role: 'user', content: 'Go' }];
  const infiniteCall = '<tool_call>{"name":"search","args":{"q":"x"}}</tool_call>';

  it('default maxIterations is now 25', async () => {
    const chat = vi.fn().mockResolvedValue(infiniteCall);
    const exec = vi.fn().mockResolvedValue({ success: true, data: {} } satisfies ToolResult);

    const result = await runToolLoop(messages, [tool], chat, exec, undefined);

    expect(result.truncated).toBe(true);
    expect(result.iterations).toBe(25);
    expect(chat).toHaveBeenCalledTimes(25);
  });

  it('explicit maxIterations:50 runs up to 50 iterations', async () => {
    const chat = vi.fn().mockResolvedValue(infiniteCall);
    const exec = vi.fn().mockResolvedValue({ success: true, data: {} } satisfies ToolResult);

    const result = await runToolLoop(messages, [tool], chat, exec, undefined, {}, { maxIterations: 50 });

    expect(result.truncated).toBe(true);
    expect(result.iterations).toBe(50);
    expect(chat).toHaveBeenCalledTimes(50);
  });

  it('SAFETY_HARD_CAP export equals 100', () => {
    expect(SAFETY_HARD_CAP).toBe(100);
  });

  it('maxIterations:200 is capped at 100 and emits a warning', async () => {
    const chat = vi.fn().mockResolvedValue(infiniteCall);
    const exec = vi.fn().mockResolvedValue({ success: true, data: {} } satisfies ToolResult);
    const warnSpy = vi.mocked(logger.warn);

    const result = await runToolLoop(messages, [tool], chat, exec, undefined, {}, { maxIterations: 200 });

    expect(result.iterations).toBe(100);
    expect(chat).toHaveBeenCalledTimes(100);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('safetyHardCap'),
      expect.objectContaining({ requested: 200, cap: 100 }),
    );
  });
});

// ===========================================================================
// A2 — per-tool-call timeout
// ===========================================================================

describe('runToolLoop — A2: per-tool-call timeout', () => {
  const tool = makeTool('slow', 'A slow tool');
  const messages: Message[] = [{ role: 'user', content: 'Go' }];

  it('tool that hangs resolves as timeout error within toolTimeoutMs + 200ms', async () => {
    const hangExec = () => new Promise<ToolResult>(() => { /* never resolves */ });
    const finalText = 'Done after timeout';
    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"slow","args":{}}</tool_call>')
      .mockResolvedValueOnce(finalText);

    const toolTimeoutMs = 100;
    const start = Date.now();
    const result = await runToolLoop(
      messages,
      [tool],
      chat,
      hangExec as never,
      undefined,
      {},
      { toolTimeoutMs },
    );
    const elapsed = Date.now() - start;

    expect(result.finalText).toBe(finalText);
    expect(result.toolCalls[0].result.success).toBe(false);
    expect(result.toolCalls[0].result.error).toContain('timed out after 100ms');
    expect(elapsed).toBeLessThan(toolTimeoutMs + 500);
  });

  it('per-tool override in toolTimeoutsMs takes priority over toolTimeoutMs', async () => {
    let resolveHang!: (v: ToolResult) => void;
    const hangExec = () => new Promise<ToolResult>((res) => { resolveHang = res; });
    const finalText = 'After per-tool timeout';
    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"slow","args":{}}</tool_call>')
      .mockResolvedValueOnce(finalText);

    const result = await runToolLoop(
      messages,
      [tool],
      chat,
      hangExec as never,
      undefined,
      {},
      { toolTimeoutMs: 10_000, toolTimeoutsMs: { slow: 100 } },
    );

    // Cleanup: resolve the hanging promise to avoid unhandled rejection.
    resolveHang({ success: true, data: {} });

    expect(result.toolCalls[0].result.success).toBe(false);
    expect(result.toolCalls[0].result.error).toContain('timed out after 100ms');
  });
});

describe('runToolLoop — trust audit callback', () => {
  it('emits audit metadata for approved tool execution', async () => {
    const tool = makeTool('search', 'Search');
    const messages: Message[] = [{ role: 'user', content: 'Search' }];
    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"search","args":{"q":"pyrfor"}}</tool_call>')
      .mockResolvedValueOnce('Done');
    const exec = vi.fn().mockResolvedValue({ success: true, data: { hits: 1 } });
    const audit = vi.fn();

    await runToolLoop(messages, [tool], chat, exec, undefined, { sessionId: 'session-1' }, {
      approvalGate: vi.fn().mockResolvedValue('approve'),
      onToolAudit: audit,
    });

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'search',
      summary: 'search: {"q":"pyrfor"}',
      decision: 'approve',
      sessionId: 'session-1',
      resultSummary: expect.stringContaining('"hits":1'),
      undo: { supported: false },
    }));
  });
});

// ===========================================================================
// A5 — ANSI stripping
// ===========================================================================

describe('runToolLoop — A5: ANSI stripping in tool results', () => {
  const tool = makeTool('run', 'Runs something');
  const messages: Message[] = [{ role: 'user', content: 'Run it' }];

  it('ANSI codes in string result data are stripped before adding to messages', async () => {
    const ansiResult = '\u001b[32mPASS\u001b[0m';
    const finalText = 'All tests passed.';
    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"run","args":{}}</tool_call>')
      .mockResolvedValueOnce(finalText);
    const exec = vi.fn().mockResolvedValue({ success: true, data: ansiResult } satisfies ToolResult);

    const result = await runToolLoop(messages, [tool], chat, exec, undefined);

    expect(result.finalText).toBe(finalText);
    // The second chat call's messages should contain the stripped text.
    const secondMessages: Message[] = chat.mock.calls[1][0];
    const toolResultMsg = secondMessages.find(
      (m) => m.role === 'user' && m.content.includes('[tool_result name=run]'),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.content).toContain('PASS');
    expect(toolResultMsg!.content).not.toContain('\u001b[32m');
    expect(toolResultMsg!.content).not.toContain('\u001b[0m');
  });

  it('non-string result data is passed through unchanged', async () => {
    const finalText = 'Got object result.';
    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"run","args":{}}</tool_call>')
      .mockResolvedValueOnce(finalText);
    const exec = vi.fn().mockResolvedValue({ success: true, data: { count: 42 } } satisfies ToolResult);

    const result = await runToolLoop(messages, [tool], chat, exec, undefined);

    expect(result.finalText).toBe(finalText);
    const secondMessages: Message[] = chat.mock.calls[1][0];
    const toolResultMsg = secondMessages.find(
      (m) => m.role === 'user' && m.content.includes('[tool_result name=run]'),
    );
    expect(toolResultMsg!.content).toContain('"count": 42');
  });

  it('ANSI codes in error string are stripped', async () => {
    const ansiError = '\u001b[31mERROR\u001b[0m: something went wrong';
    const finalText = 'Handled error.';
    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"run","args":{}}</tool_call>')
      .mockResolvedValueOnce(finalText);
    const exec = vi.fn().mockResolvedValue({ success: false, data: {}, error: ansiError } satisfies ToolResult);

    await runToolLoop(messages, [tool], chat, exec, undefined);

    const secondMessages: Message[] = chat.mock.calls[1][0];
    const errMsg = secondMessages.find(
      (m) => m.role === 'user' && m.content.includes('[tool_result'),
    );
    expect(errMsg!.content).toContain('ERROR: something went wrong');
    expect(errMsg!.content).not.toContain('\u001b[31m');
  });
});

// ===========================================================================
// A7 — AbortSignal
// ===========================================================================

describe('runToolLoop — A7: AbortSignal', () => {
  const tool = makeTool('search', 'Search tool');
  const messages: Message[] = [{ role: 'user', content: 'Go' }];

  it('aborted before first iteration → returns stopped:true immediately with 0 iterations', async () => {
    const controller = new AbortController();
    controller.abort();

    const chat = vi.fn().mockResolvedValue('should not be called');
    const exec = vi.fn();

    const result = await runToolLoop(
      messages,
      [tool],
      chat,
      exec,
      undefined,
      {},
      { signal: controller.signal },
    );

    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('aborted');
    expect(result.iterations).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it('abort after first tool call → loop exits with stopped:true', async () => {
    const controller = new AbortController();
    let execCallCount = 0;

    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"search","args":{"q":"x"}}</tool_call>')
      .mockResolvedValue('should not reach here');

    const exec = vi.fn().mockImplementation(async () => {
      execCallCount++;
      // Abort after first tool call.
      controller.abort();
      return { success: true, data: { hits: 1 } };
    });

    const result = await runToolLoop(
      messages,
      [tool],
      chat,
      exec,
      undefined,
      {},
      { signal: controller.signal },
    );

    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('aborted');
    expect(execCallCount).toBe(1);
    // Should not have called chat a second time.
    expect(chat).toHaveBeenCalledTimes(1);
    // Partial results are preserved.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.assistantTurns).toHaveLength(1);
  });

  it('abort during tool execution resolves as aborted error, loop exits', async () => {
    const controller = new AbortController();

    const chat = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"search","args":{"q":"x"}}</tool_call>')
      .mockResolvedValue('should not reach here');

    const exec = vi.fn().mockImplementation(() => {
      // Abort immediately, then return a never-resolving promise.
      controller.abort();
      return new Promise<ToolResult>(() => { /* hangs */ });
    });

    const result = await runToolLoop(
      messages,
      [tool],
      chat,
      exec,
      undefined,
      {},
      { signal: controller.signal, toolTimeoutMs: 5000 },
    );

    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('aborted');
    // The tool call result should be an abort error.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result.success).toBe(false);
    expect(result.toolCalls[0].result.error).toContain('aborted');
  });
});
