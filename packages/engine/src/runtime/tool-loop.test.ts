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

    it('skips tool_call without "name" field', () => {
      const text = '<tool_call>{"args":{"x":1}}</tool_call>';
      expect(parseToolCalls(text)).toEqual([]);
    });

    it('returns [] and does not throw on completely broken JSON', () => {
      const text = '<tool_call>{{{{not json at all}}}}</tool_call>';
      expect(() => parseToolCalls(text)).not.toThrow();
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

    it('case 4: executor throws → success:false result returned, loop continues', async () => {
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

      // Loop must not throw
      expect(result.truncated).toBe(false);
    });
  });
});
