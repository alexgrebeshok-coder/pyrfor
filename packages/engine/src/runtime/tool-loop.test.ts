// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseToolCalls,
  stripToolCalls,
  buildToolInstructions,
  runToolLoop,
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
    // OpenAI native tool_calls JSON blob in text
    // -----------------------------------------------------------------------
    // This module is prompt-based: models are instructed to emit <tool_call>
    // tags. An OpenAI-style {"tool_calls":[...]} JSON blob that appears as
    // raw text (e.g. from a misconfigured adapter) is intentionally NOT parsed
    // — it has no <tool_call> opening tag.
    it('OpenAI-format tool_calls JSON blob → [] (unsupported; prompt-based only)', () => {
      const text = JSON.stringify({
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      });
      expect(parseToolCalls(text)).toEqual([]);
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
    // NEW: Anthropic tool_use format is not supported (prompt-based only)
    // -----------------------------------------------------------------------
    it('Anthropic-style tool_use block → [] (prompt-based parser ignores it)', () => {
      // If a misconfigured adapter leaks native Anthropic tool_use JSON as text,
      // there is no <tool_call> opener, so parseToolCalls returns [].
      const text = JSON.stringify({
        type: 'tool_use',
        id: 'toolu_01abc',
        name: 'search',
        input: { q: 'test' },
      });
      expect(parseToolCalls(text)).toEqual([]);
    });

    it('Anthropic XML-style <tool_use> tag → [] (different tag name, not parsed)', () => {
      const text = '<tool_use>{"name":"search","args":{"q":"test"}}</tool_use>';
      expect(parseToolCalls(text)).toEqual([]);
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
    // NEW: default max iterations (5) reached
    // -----------------------------------------------------------------------
    it('case 5: default max 5 iterations reached → truncated=true, iterations=5', async () => {
      const infiniteToolCall = '<tool_call>{"name":"search","args":{"q":"x"}}</tool_call>';
      const chat = vi.fn().mockResolvedValue(infiniteToolCall);
      const exec = vi.fn().mockResolvedValue({ success: true, data: {} } satisfies ToolResult);

      // Use default maxIterations (5)
      const result = await runToolLoop(messages, [tool], chat, exec, undefined);

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
  });
});
