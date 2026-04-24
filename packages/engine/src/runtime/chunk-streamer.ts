/**
 * chunk-streamer.ts
 * Bidirectional streaming utilities for SSE (text/event-stream) and JSONL.
 * Uses Node built-ins only.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export interface ParserStats {
  bytes: number;
  events: number;
  errors: number;
}

// ─── SSE ─────────────────────────────────────────────────────────────────────

/**
 * Creates a stateful, incremental SSE parser.
 * Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export function createSseParser() {
  let buf = '';
  let dataLines: string[] = [];
  let id: string | undefined;
  let eventType: string | undefined;
  let retry: number | undefined;
  const stats: ParserStats = { bytes: 0, events: 0, errors: 0 };

  function dispatchIfReady(): SseEvent | null {
    // Dispatch when we have any buffered field (data, event, id, retry)
    if (dataLines.length === 0 && eventType === undefined && id === undefined && retry === undefined) {
      return null;
    }
    const ev: SseEvent = { data: dataLines.join('\n') };
    if (id !== undefined) ev.id = id;
    if (eventType !== undefined) ev.event = eventType;
    if (retry !== undefined) ev.retry = retry;
    // Reset buffer
    dataLines = [];
    eventType = undefined;
    retry = undefined;
    // id persists across events per spec but we reset per dispatch for simplicity
    id = undefined;
    return ev;
  }

  function processLines(lines: string[]): SseEvent[] {
    const events: SseEvent[] = [];
    for (const raw of lines) {
      const line = raw.replace(/\r$/, ''); // tolerate CRLF already split on \n
      if (line === '') {
        // blank line → dispatch
        const ev = dispatchIfReady();
        if (ev !== null) {
          stats.events++;
          events.push(ev);
        }
        continue;
      }
      if (line.startsWith(':')) continue; // comment

      const colonIdx = line.indexOf(':');
      let field: string;
      let value: string;
      if (colonIdx === -1) {
        field = line;
        value = '';
      } else {
        field = line.slice(0, colonIdx);
        value = line.slice(colonIdx + 1).replace(/^ /, ''); // strip single leading space
      }

      switch (field) {
        case 'data':
          dataLines.push(value);
          break;
        case 'id':
          id = value;
          break;
        case 'event':
          eventType = value;
          break;
        case 'retry': {
          const n = Number(value);
          if (!isNaN(n) && String(Math.floor(n)) === value.trim()) {
            retry = n;
          }
          break;
        }
        // unknown fields ignored per spec
      }
    }
    return events;
  }

  return {
    feed(chunk: string | Uint8Array): SseEvent[] {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      stats.bytes += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      buf += text;
      // Normalise \r\n → \n
      const normalised = buf.replace(/\r\n/g, '\n');
      const lastNl = normalised.lastIndexOf('\n');
      if (lastNl === -1) return []; // no complete line yet
      const complete = normalised.slice(0, lastNl + 1);
      buf = normalised.slice(lastNl + 1);
      // split('\n') on a string ending with \n always produces a trailing '' artifact — drop it
      const lines = complete.split('\n').slice(0, -1);
      return processLines(lines);
    },

    flush(): SseEvent[] {
      if (!buf) return [];
      const text = buf;
      buf = '';
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      // Push a blank line to trigger dispatch
      lines.push('');
      return processLines(lines).filter((_, i, arr) => {
        void i; void arr; return true;
      });
    },

    reset(): void {
      buf = '';
      dataLines = [];
      id = undefined;
      eventType = undefined;
      retry = undefined;
    },

    getStats(): ParserStats {
      return { ...stats };
    },
  };
}

/** Render an SSE event as a string block ending with a double newline. */
export function formatSse(event: SseEvent): string {
  let out = '';
  if (event.id !== undefined) out += `id: ${event.id}\n`;
  if (event.event !== undefined) out += `event: ${event.event}\n`;
  if (event.retry !== undefined) out += `retry: ${event.retry}\n`;
  // data may contain multiple lines
  for (const line of event.data.split('\n')) {
    out += `data: ${line}\n`;
  }
  out += '\n';
  return out;
}

/** Async generator that yields SseEvents from an async source. */
export async function* createSseStream(opts: {
  source: AsyncIterable<string | Uint8Array>;
}): AsyncGenerator<SseEvent> {
  const parser = createSseParser();
  for await (const chunk of opts.source) {
    for (const ev of parser.feed(chunk)) {
      yield ev;
    }
  }
  for (const ev of parser.flush()) {
    yield ev;
  }
}

// ─── JSONL ────────────────────────────────────────────────────────────────────

/** Creates a stateful, incremental JSONL parser. */
export function createJsonlParser(opts?: { onError?: (err: Error, line: string) => void }) {
  let buf = '';
  const stats: ParserStats = { bytes: 0, events: 0, errors: 0 };

  function parseLines(lines: string[], includeLast: boolean): unknown[] {
    const results: unknown[] = [];
    const limit = includeLast ? lines.length : lines.length - 1;
    for (let i = 0; i < limit; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        results.push(JSON.parse(line));
        stats.events++;
      } catch (e) {
        stats.errors++;
        opts?.onError?.(e instanceof Error ? e : new Error(String(e)), lines[i]);
      }
    }
    return results;
  }

  return {
    feed(chunk: string | Uint8Array): unknown[] {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      stats.bytes += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      buf += text;
      const lines = buf.split('\n');
      // Last element is the incomplete tail
      buf = lines[lines.length - 1];
      return parseLines(lines, false);
    },

    flush(): unknown[] {
      if (!buf.trim()) {
        buf = '';
        return [];
      }
      const line = buf;
      buf = '';
      return parseLines([line], true);
    },

    reset(): void {
      buf = '';
    },

    getStats(): ParserStats {
      return { ...stats };
    },
  };
}

/** Render an array of items as a JSONL string. */
export function formatJsonl(items: unknown[]): string {
  return items.map((v) => JSON.stringify(v)).join('\n') + '\n';
}

/** Async generator that yields parsed JSONL values from an async source. */
export async function* createJsonlStream<T = unknown>(opts: {
  source: AsyncIterable<string | Uint8Array>;
  onError?: (err: Error, line: string) => void;
}): AsyncGenerator<T> {
  const parser = createJsonlParser({ onError: opts.onError });
  for await (const chunk of opts.source) {
    for (const item of parser.feed(chunk)) {
      yield item as T;
    }
  }
  for (const item of parser.flush()) {
    yield item as T;
  }
}
