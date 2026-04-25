// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseToolCalls,
  stripToolCalls,
  extractFirstJsonObject,
  type ParsedToolCall,
  type ParseOptions,
} from './tool-call-parser';
import { logger } from '../observability/logger';

// Silence logger during tests.
vi.mock('../observability/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('tool-call-parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // extractFirstJsonObject
  // ═════════════════════════════════════════════════════════════════════════
  describe('extractFirstJsonObject', () => {
    it('extracts balanced object from string', () => {
      const result = extractFirstJsonObject('prefix {"a":1,"b":2} suffix');
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('handles nested braces', () => {
      const result = extractFirstJsonObject('{"outer":{"inner":3}}');
      expect(result).toBe('{"outer":{"inner":3}}');
    });

    it('skips braces inside quoted strings', () => {
      const result = extractFirstJsonObject('{"cmd":"echo {test}"}');
      expect(result).toBe('{"cmd":"echo {test}"}');
    });

    it('returns null if no object found', () => {
      expect(extractFirstJsonObject('no braces here')).toBeNull();
    });

    it('returns null if unbalanced', () => {
      expect(extractFirstJsonObject('{"incomplete":')).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Strategy 1: Tagged <tool_call> (4 existing shapes)
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - Strategy 1: Tagged <tool_call>', () => {
    it('form 1: <tool_call>{json}</tool_call>', () => {
      const text = '<tool_call>{"name":"search","args":{"q":"hello"}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ q: 'hello' });
      expect(calls[0].raw).toBe(text);
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

    it('supports "arguments" key as alias for "args"', () => {
      const text = '<tool_call>{"name":"run","arguments":{"cmd":"ls"}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual({ cmd: 'ls' });
    });

    it('handles JSON with ">" inside string value (GLM form)', () => {
      const text = '<tool_call={"name":"shell","args":{"cmd":"echo a>b"}}>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('shell');
      expect(calls[0].args).toEqual({ cmd: 'echo a>b' });
    });

    it('repairs unquoted keys', () => {
      const text = '<tool_call>{name:"foo",args:{x:1}}</tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('foo');
      expect(calls[0].args).toEqual({ x: 1 });
    });

    it('repairs single quotes', () => {
      const text = "<tool_call>{'name':'bar','args':{'y':2}}</tool_call>";
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('bar');
      expect(calls[0].args).toEqual({ y: 2 });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Strategy 2: arg-key/arg-value XML (production bug fix)
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - Strategy 2: arg-key/arg-value XML', () => {
    it('parses English payload from production logs (inside <tool_call>)', () => {
      const text =
        '<tool_call>web_search<arg_key>query</arg_key><arg_value>multi-agent systems latest developments 2025 2026 best practices</arg_value></tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('web_search');
      expect(calls[0].args).toEqual({
        query: 'multi-agent systems latest developments 2025 2026 best practices',
      });
    });

    it('parses Russian payload from production logs (inside <tool_call>)', () => {
      const text =
        '<tool_call>web_search<arg_key>query</arg_key><arg_value>мультиагентные системы ИИ 2026 последние разработки лучшие практики</arg_value></tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('web_search');
      expect(calls[0].args).toEqual({
        query: 'мультиагентные системы ИИ 2026 последние разработки лучшие практики',
      });
    });

    it('parses mangled variant from logs', () => {
      // This one has a mangled closing but should still extract the tool name and first arg.
      const text =
        '<tool_call>web_search<arg_key>query</arg_key><arg_value>multi-agent AI systems 2025 2026 latest developments best practices</arg_value>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('web_search');
      expect(calls[0].args.query).toContain('multi-agent AI systems');
    });

    it('parses multiple arg pairs', () => {
      const text =
        '<tool_call>myTool<arg_key>param1</arg_key><arg_value>value1</arg_value><arg_key>param2</arg_key><arg_value>value2</arg_value></tool_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('myTool');
      expect(calls[0].args).toEqual({ param1: 'value1', param2: 'value2' });
    });

    it('parses arg-xml without <tool_call> wrapper (standalone)', () => {
      const text =
        'web_search<arg_key>query</arg_key><arg_value>standalone query</arg_value>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('web_search');
      expect(calls[0].args).toEqual({ query: 'standalone query' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Strategy 3: Anthropic-style <function_call> and <tool_use>
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - Strategy 3: <function_call> and <tool_use>', () => {
    it('parses <function_call> tag', () => {
      const text = '<function_call>{"name":"getData","args":{"id":123}}</function_call>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('getData');
      expect(calls[0].args).toEqual({ id: 123 });
    });

    it('parses <tool_use> tag', () => {
      const text = '<tool_use>{"name":"fetch","arguments":{"url":"http://example.com"}}</tool_use>';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('fetch');
      expect(calls[0].args).toEqual({ url: 'http://example.com' });
    });

    it('handles unclosed <function_call>', () => {
      const text = '<function_call>{"name":"test","args":{}}';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('test');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Strategy 4: OpenAI native tool_calls array
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - Strategy 4: OpenAI native tool_calls', () => {
    it('parses OpenAI tool_calls with double-encoded arguments', () => {
      const text = JSON.stringify({
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: {
              name: 'getWeather',
              arguments: JSON.stringify({ location: 'NYC', unit: 'celsius' }),
            },
          },
        ],
      });
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('getWeather');
      expect(calls[0].args).toEqual({ location: 'NYC', unit: 'celsius' });
    });

    it('parses multiple calls in tool_calls array', () => {
      const text = JSON.stringify({
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'tool1', arguments: JSON.stringify({ a: 1 }) },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'tool2', arguments: JSON.stringify({ b: 2 }) },
          },
        ],
      });
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(2);
      expect(calls[0].name).toBe('tool1');
      expect(calls[1].name).toBe('tool2');
    });

    it('ignores non-function types in tool_calls', () => {
      const text = JSON.stringify({
        tool_calls: [
          { id: 'call_x', type: 'other', data: {} },
          {
            id: 'call_y',
            type: 'function',
            function: { name: 'valid', arguments: '{}' },
          },
        ],
      });
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('valid');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Strategy 5: Bare JSON object
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - Strategy 5: Bare object', () => {
    it('parses fenced ```json block', () => {
      const text = '```json\n{"name":"search","args":{"q":"test"}}\n```';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ q: 'test' });
    });

    it('parses bare JSON object without wrapper (when no tagged calls found)', () => {
      // Test bare-object strategy in isolation by disabling other strategies.
      const text = '{"name":"bare","args":{"x":42}}';
      const calls = parseToolCalls(text, {
        disableStrategies: ['tagged', 'arg-xml', 'function-call-tag', 'openai-native', 'line-kv'],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('bare');
      expect(calls[0].args).toEqual({ x: 42 });
    });

    it('does NOT activate bare-object if tagged calls already found', () => {
      const text =
        '<tool_call>{"name":"tagged","args":{}}</tool_call>\n{"name":"bare","args":{}}';
      const calls = parseToolCalls(text);
      // Should only get the tagged call, not the bare one.
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('tagged');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Strategy 6: Plain text key:value lines (conservative fallback)
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - Strategy 6: Line key:value', () => {
    it('parses simple key:value format (positive case)', () => {
      const text = 'search\nquery: latest news\nlimit: 10';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('search');
      expect(calls[0].args).toEqual({ query: 'latest news', limit: '10' });
    });

    it('does NOT misinterpret prose as tool call (negative case)', () => {
      const text = 'This is a paragraph.\nIt has multiple lines.\nBut no tool call.';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(0);
    });

    it('does NOT activate if text too long', () => {
      const longText = 'tool\n' + 'x: 1\n'.repeat(200);
      const calls = parseToolCalls(longText);
      // Should be empty because text length > 500.
      expect(calls).toHaveLength(0);
    });

    it('does NOT activate if tagged calls found', () => {
      const text = '<tool_call>{"name":"tagged","args":{}}</tool_call>\nsearch\nq: test';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('tagged');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // stripToolCalls
  // ═════════════════════════════════════════════════════════════════════════
  describe('stripToolCalls', () => {
    it('removes <tool_call> tags', () => {
      const text = 'Before <tool_call>{"name":"x","args":{}}</tool_call> After';
      expect(stripToolCalls(text)).toBe('Before  After');
    });

    it('removes arg-xml format', () => {
      const text =
        'Start web_search<arg_key>query</arg_key><arg_value>test</arg_value> End';
      expect(stripToolCalls(text)).toBe('Start End');
    });

    it('removes <function_call> tags', () => {
      const text = 'Prefix <function_call>{"name":"fn","args":{}}</function_call> Suffix';
      expect(stripToolCalls(text)).toBe('Prefix  Suffix');
    });

    it('removes <tool_use> tags', () => {
      const text = 'A <tool_use>{"name":"use","args":{}}</tool_use> B';
      expect(stripToolCalls(text)).toBe('A  B');
    });

    it('collapses multiple newlines', () => {
      const text = 'Line1\n\n\n<tool_call>{"name":"x","args":{}}</tool_call>\n\n\nLine2';
      const result = stripToolCalls(text);
      expect(result).not.toContain('\n\n\n');
    });

    it('handles multiple tool calls', () => {
      const text =
        '<tool_call>{"name":"a","args":{}}</tool_call> Middle <tool_call>{"name":"b","args":{}}</tool_call>';
      expect(stripToolCalls(text)).toBe('Middle');
    });

    it('handles unclosed <tool_call> at end', () => {
      const text = 'Some text <tool_call>';
      expect(stripToolCalls(text)).toBe('Some text');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Multiple calls, mixed shapes
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - multiple calls of mixed shapes', () => {
    it('extracts all calls in source order', () => {
      const text = `
        First call: <tool_call>{"name":"call1","args":{"a":1}}</tool_call>
        Second call: <function_call>{"name":"call2","args":{"b":2}}</function_call>
        Third call: web_search<arg_key>query</arg_key><arg_value>test</arg_value>
      `;
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(3);
      expect(calls[0].name).toBe('call1');
      expect(calls[1].name).toBe('call2');
      expect(calls[2].name).toBe('web_search');
      // Verify source order.
      const idx1 = text.indexOf(calls[0].raw);
      const idx2 = text.indexOf(calls[1].raw);
      const idx3 = text.indexOf(calls[2].raw);
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Error handling
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - error handling', () => {
    it('returns empty array on garbage input', () => {
      const text = 'Complete garbage with no structure at all!';
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(0);
    });

    it('calls onParseFailure for invalid JSON in <tool_call>', () => {
      const mockCallback = vi.fn();
      const text = '<tool_call>{this is not json}</tool_call>';
      const calls = parseToolCalls(text, { onParseFailure: mockCallback });
      expect(calls).toHaveLength(0);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'tagged',
          error: expect.any(String),
        }),
      );
    });

    it('uses default logger.warn if no onParseFailure provided', () => {
      const text = '<tool_call>{invalid json}</tool_call>';
      parseToolCalls(text);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // disableStrategies option
  // ═════════════════════════════════════════════════════════════════════════
  describe('parseToolCalls - disableStrategies option', () => {
    it('skips tagged strategy when disabled', () => {
      const text = '<tool_call>{"name":"x","args":{}}</tool_call>';
      const calls = parseToolCalls(text, {
        disableStrategies: ['tagged', 'bare-object', 'line-kv'],
      });
      expect(calls).toHaveLength(0);
    });

    it('skips arg-xml strategy when disabled', () => {
      const text =
        '<tool_call>tool<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>';
      const calls = parseToolCalls(text, {
        disableStrategies: ['arg-xml', 'bare-object', 'line-kv'],
      });
      expect(calls).toHaveLength(0);
    });

    it('skips function-call-tag strategy when disabled', () => {
      const text = '<function_call>{"name":"fn","args":{}}</function_call>';
      const calls = parseToolCalls(text, {
        disableStrategies: ['function-call-tag', 'bare-object', 'line-kv'],
      });
      expect(calls).toHaveLength(0);
    });

    it('skips openai-native strategy when disabled', () => {
      const text = JSON.stringify({
        tool_calls: [
          {
            type: 'function',
            function: { name: 'test', arguments: '{}' },
          },
        ],
      });
      const calls = parseToolCalls(text, {
        disableStrategies: ['openai-native', 'bare-object', 'line-kv'],
      });
      expect(calls).toHaveLength(0);
    });

    it('skips bare-object strategy when disabled', () => {
      const text = '{"name":"bare","args":{}}';
      const calls = parseToolCalls(text, { disableStrategies: ['bare-object'] });
      expect(calls).toHaveLength(0);
    });

    it('skips line-kv strategy when disabled', () => {
      const text = 'tool\nkey: value';
      const calls = parseToolCalls(text, { disableStrategies: ['line-kv'] });
      expect(calls).toHaveLength(0);
    });
  });
});
