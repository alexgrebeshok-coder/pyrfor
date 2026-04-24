// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  createSseParser,
  formatSse,
  createSseStream,
  createJsonlParser,
  formatJsonl,
  createJsonlStream,
  type SseEvent,
} from './chunk-streamer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield p;
}

// ─── SSE Parser ───────────────────────────────────────────────────────────────

describe('createSseParser', () => {
  it('parses a single complete event with data', () => {
    const parser = createSseParser();
    const events = parser.feed('data: hello world\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('hello world');
  });

  it('joins multiple data lines with newline', () => {
    const parser = createSseParser();
    const events = parser.feed('data: line1\ndata: line2\ndata: line3\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('line1\nline2\nline3');
  });

  it('parses id field', () => {
    const parser = createSseParser();
    const events = parser.feed('id: 42\ndata: hi\n\n');
    expect(events[0].id).toBe('42');
  });

  it('parses event field', () => {
    const parser = createSseParser();
    const events = parser.feed('event: myEvent\ndata: payload\n\n');
    expect(events[0].event).toBe('myEvent');
  });

  it('parses retry field', () => {
    const parser = createSseParser();
    const events = parser.feed('retry: 3000\ndata: ok\n\n');
    expect(events[0].retry).toBe(3000);
  });

  it('ignores non-numeric retry', () => {
    const parser = createSseParser();
    const events = parser.feed('retry: abc\ndata: ok\n\n');
    expect(events[0].retry).toBeUndefined();
  });

  it('parses multiple events in one chunk', () => {
    const parser = createSseParser();
    const input = 'data: first\n\ndata: second\n\n';
    const events = parser.feed(input);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe('first');
    expect(events[1].data).toBe('second');
  });

  it('reassembles partial chunks across feed calls', () => {
    const parser = createSseParser();
    let events = parser.feed('data: hel');
    expect(events).toHaveLength(0);
    events = parser.feed('lo\n');
    expect(events).toHaveLength(0);
    events = parser.feed('\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('hello');
  });

  it('ignores comment lines starting with colon', () => {
    const parser = createSseParser();
    const events = parser.feed(': this is a comment\ndata: real\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('real');
  });

  it('handles CRLF line endings', () => {
    const parser = createSseParser();
    const events = parser.feed('data: crlf\r\nevent: test\r\n\r\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('crlf');
    expect(events[0].event).toBe('test');
  });

  it('handles Uint8Array input', () => {
    const parser = createSseParser();
    const encoded = new TextEncoder().encode('data: bytes\n\n');
    const events = parser.feed(encoded);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('bytes');
  });

  it('reset clears internal buffer and state', () => {
    const parser = createSseParser();
    parser.feed('data: partial');
    parser.reset();
    const events = parser.feed('\n\n');
    // After reset the partial data is gone; blank line with no fields → no dispatch
    expect(events).toHaveLength(0);
  });

  it('getStats counts bytes and events', () => {
    const parser = createSseParser();
    parser.feed('data: hi\n\n');
    const stats = parser.getStats();
    expect(stats.bytes).toBe(10);
    expect(stats.events).toBe(1);
    expect(stats.errors).toBe(0);
  });

  it('getStats accumulates across multiple feeds', () => {
    const parser = createSseParser();
    parser.feed('data: a\n\n');
    parser.feed('data: b\n\ndata: c\n\n');
    expect(parser.getStats().events).toBe(3);
  });

  it('dispatches event with only event field set (no data)', () => {
    const parser = createSseParser();
    const events = parser.feed('event: ping\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('ping');
    expect(events[0].data).toBe('');
  });

  it('does not dispatch on blank line with no fields', () => {
    const parser = createSseParser();
    const events = parser.feed('\n\n');
    expect(events).toHaveLength(0);
  });

  it('strips single space after colon in field value', () => {
    const parser = createSseParser();
    const events = parser.feed('data:  double space\n\n');
    // Only the first space is stripped per spec
    expect(events[0].data).toBe(' double space');
  });

  it('handles field with no colon as field name with empty value', () => {
    const parser = createSseParser();
    // "data" with no colon → field=data, value=''
    const events = parser.feed('data\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('');
  });
});

// ─── formatSse ────────────────────────────────────────────────────────────────

describe('formatSse', () => {
  it('produces valid SSE with data only', () => {
    const out = formatSse({ data: 'hello' });
    expect(out).toBe('data: hello\n\n');
  });

  it('includes all optional fields', () => {
    const out = formatSse({ id: '1', event: 'update', data: 'payload', retry: 5000 });
    expect(out).toContain('id: 1\n');
    expect(out).toContain('event: update\n');
    expect(out).toContain('retry: 5000\n');
    expect(out).toContain('data: payload\n');
    expect(out.endsWith('\n\n')).toBe(true);
  });

  it('splits multi-line data into separate data: lines', () => {
    const out = formatSse({ data: 'line1\nline2' });
    expect(out).toBe('data: line1\ndata: line2\n\n');
  });

  it('round-trips through parser', () => {
    const original: SseEvent = { id: '99', event: 'msg', data: 'hello\nworld', retry: 1000 };
    const parser = createSseParser();
    const events = parser.feed(formatSse(original));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(original);
  });
});

// ─── SSE flush ────────────────────────────────────────────────────────────────

describe('createSseParser flush', () => {
  it('emits remaining buffered event on flush', () => {
    const parser = createSseParser();
    parser.feed('data: unterminated');
    const events = parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('unterminated');
  });

  it('flush returns empty when buffer is empty', () => {
    const parser = createSseParser();
    expect(parser.flush()).toHaveLength(0);
  });
});

// ─── createSseStream ──────────────────────────────────────────────────────────

describe('createSseStream', () => {
  it('yields events in order from async source', async () => {
    const source = chunks('data: one\n\n', 'data: two\n\ndata: three\n\n');
    const gen = createSseStream({ source });
    const results: SseEvent[] = [];
    for await (const ev of gen) results.push(ev);
    expect(results).toHaveLength(3);
    expect(results.map((e) => e.data)).toEqual(['one', 'two', 'three']);
  });

  it('handles chunked SSE across async yields', async () => {
    const source = chunks('data: hel', 'lo\n\n');
    const results: SseEvent[] = [];
    for await (const ev of createSseStream({ source })) results.push(ev);
    expect(results).toHaveLength(1);
    expect(results[0].data).toBe('hello');
  });

  it('flushes partial event after source ends', async () => {
    const source = chunks('event: end\ndata: fin');
    const results: SseEvent[] = [];
    for await (const ev of createSseStream({ source })) results.push(ev);
    expect(results).toHaveLength(1);
    expect(results[0].event).toBe('end');
  });

  it('handles Uint8Array chunks from async source', async () => {
    async function* byteSource(): AsyncGenerator<Uint8Array> {
      yield new TextEncoder().encode('data: bytes\n\n');
    }
    const results: SseEvent[] = [];
    for await (const ev of createSseStream({ source: byteSource() })) results.push(ev);
    expect(results[0].data).toBe('bytes');
  });
});

// ─── JSONL Parser ─────────────────────────────────────────────────────────────

describe('createJsonlParser', () => {
  it('parses a single JSON line', () => {
    const parser = createJsonlParser();
    const items = parser.feed('{"a":1}\n');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ a: 1 });
  });

  it('parses multiple lines in one chunk', () => {
    const parser = createJsonlParser();
    const items = parser.feed('1\n2\n3\n');
    expect(items).toEqual([1, 2, 3]);
  });

  it('reassembles partial chunks across feed calls', () => {
    const parser = createJsonlParser();
    let items = parser.feed('{"x":');
    expect(items).toHaveLength(0);
    items = parser.feed('42}\n');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ x: 42 });
  });

  it('skips empty lines', () => {
    const parser = createJsonlParser();
    const items = parser.feed('1\n\n2\n');
    expect(items).toEqual([1, 2]);
  });

  it('invokes onError for malformed JSON and counts error', () => {
    const onError = vi.fn();
    const parser = createJsonlParser({ onError });
    const items = parser.feed('not-json\n{"ok":true}\n');
    expect(onError).toHaveBeenCalledOnce();
    expect(items).toHaveLength(1);
    expect(parser.getStats().errors).toBe(1);
  });

  it('continues parsing after a malformed line', () => {
    const onError = vi.fn();
    const parser = createJsonlParser({ onError });
    const items = parser.feed('bad\n42\n"hello"\n');
    expect(items).toEqual([42, 'hello']);
  });

  it('getStats tracks bytes and events', () => {
    const parser = createJsonlParser();
    parser.feed('"hi"\n');
    const s = parser.getStats();
    expect(s.events).toBe(1);
    expect(s.bytes).toBe(5);
  });

  it('handles Uint8Array input', () => {
    const parser = createJsonlParser();
    const enc = new TextEncoder().encode('"bytes"\n');
    const items = parser.feed(enc);
    expect(items).toEqual(['bytes']);
  });

  it('reset clears buffer', () => {
    const parser = createJsonlParser();
    parser.feed('{"partial":');
    parser.reset();
    const items = parser.flush();
    expect(items).toHaveLength(0);
  });

  it('flush emits last unterminated line', () => {
    const parser = createJsonlParser();
    parser.feed('123');
    const items = parser.flush();
    expect(items).toEqual([123]);
  });

  it('flush returns empty when buffer is empty', () => {
    const parser = createJsonlParser();
    expect(parser.flush()).toHaveLength(0);
  });

  it('flush returns empty when buffer is whitespace only', () => {
    const parser = createJsonlParser();
    parser.feed('   ');
    expect(parser.flush()).toHaveLength(0);
  });
});

// ─── formatJsonl ──────────────────────────────────────────────────────────────

describe('formatJsonl', () => {
  it('serialises items one per line with trailing newline', () => {
    const out = formatJsonl([1, 'two', { three: 3 }]);
    expect(out).toBe('1\n"two"\n{"three":3}\n');
  });

  it('round-trips through parser', () => {
    const originals = [{ a: 1 }, { b: 2 }, [3, 4]];
    const parser = createJsonlParser();
    const items = parser.feed(formatJsonl(originals));
    expect(items).toEqual(originals);
  });

  it('handles empty array', () => {
    expect(formatJsonl([])).toBe('\n');
  });
});

// ─── createJsonlStream ────────────────────────────────────────────────────────

describe('createJsonlStream', () => {
  it('yields parsed values in order', async () => {
    const source = chunks('1\n2\n3\n');
    const results: unknown[] = [];
    for await (const item of createJsonlStream({ source })) results.push(item);
    expect(results).toEqual([1, 2, 3]);
  });

  it('reassembles partial chunks across async yields', async () => {
    const source = chunks('{"x":', '1}\n');
    const results: unknown[] = [];
    for await (const item of createJsonlStream({ source })) results.push(item);
    expect(results).toEqual([{ x: 1 }]);
  });

  it('flushes unterminated last line after source ends', async () => {
    const source = chunks('42');
    const results: unknown[] = [];
    for await (const item of createJsonlStream({ source })) results.push(item);
    expect(results).toEqual([42]);
  });

  it('invokes onError for malformed lines and continues', async () => {
    const onError = vi.fn();
    const source = chunks('bad\n99\n');
    const results: unknown[] = [];
    for await (const item of createJsonlStream({ source, onError })) results.push(item);
    expect(onError).toHaveBeenCalledOnce();
    expect(results).toEqual([99]);
  });

  it('works with typed generic T', async () => {
    type Point = { x: number; y: number };
    const source = chunks('{"x":1,"y":2}\n{"x":3,"y":4}\n');
    const results: Point[] = [];
    for await (const p of createJsonlStream<Point>({ source })) results.push(p);
    expect(results).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('handles Uint8Array chunks from async source', async () => {
    async function* byteSource(): AsyncGenerator<Uint8Array> {
      yield new TextEncoder().encode('"hello"\n');
    }
    const results: unknown[] = [];
    for await (const item of createJsonlStream({ source: byteSource() })) results.push(item);
    expect(results).toEqual(['hello']);
  });
});
