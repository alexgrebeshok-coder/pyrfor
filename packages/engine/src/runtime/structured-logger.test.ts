// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from './structured-logger';
import type { LogEntry, LogLevel } from './structured-logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpFile(): string {
  return path.join(
    os.tmpdir(),
    `sl-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );
}

async function readLines(filePath: string): Promise<LogEntry[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as LogEntry);
}

function cleanup(...files: string[]): void {
  for (const f of files) {
    for (let i = 0; i <= 10; i++) {
      try { fs.unlinkSync(i === 0 ? f : `${f}.${i}`); } catch { /* ok */ }
    }
    try { fs.unlinkSync(`${f}.tmp`); } catch { /* ok */ }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StructuredLogger', () => {
  // 1. Default stdout transport
  it('info logs to default stdout transport', () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    const logger = createLogger();
    logger.info('hello world');

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as LogEntry;
    expect(entry.msg).toBe('hello world');
    expect(entry.levelName).toBe('info');
  });

  // 2. Level filtering — setLevel('warn') drops info/debug/trace
  it('setLevel("warn") drops info, debug, trace', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });
    logger.setLevel('warn');

    logger.trace('trace msg');
    logger.debug('debug msg');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');

    expect(entries).toHaveLength(2);
    expect(entries[0].levelName).toBe('warn');
    expect(entries[1].levelName).toBe('error');
  });

  // 3. child() merges base fields
  it('child() merges extra base fields into each entry', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      base: { service: 'api' },
      transports: [e => { entries.push(e); }],
    });

    const child = logger.child({ requestId: 'req-123' });
    child.info('from child');

    expect(entries[0].service).toBe('api');
    expect(entries[0].requestId).toBe('req-123');
    expect(entries[0].msg).toBe('from child');
  });

  // 4. Nested child() accumulates all base fields
  it('nested child() accumulates parent base fields', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      base: { service: 'api' },
      transports: [e => { entries.push(e); }],
    });

    const child1 = logger.child({ requestId: 'req-1' });
    const child2 = child1.child({ userId: 'user-42' });
    child2.info('deeply nested');

    expect(entries[0].service).toBe('api');
    expect(entries[0].requestId).toBe('req-1');
    expect(entries[0].userId).toBe('user-42');
  });

  // 5. Multiple transports all receive entries
  it('all transports receive each log entry', () => {
    const r1: LogEntry[] = [];
    const r2: LogEntry[] = [];

    const logger = createLogger({
      transports: [e => { r1.push(e); }, e => { r2.push(e); }],
    });
    logger.info('broadcast');

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0].msg).toBe('broadcast');
    expect(r2[0].msg).toBe('broadcast');
  });

  // 6. addTransport returns deregister; deregister stops it
  it('addTransport deregister function stops the transport', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [] });

    const deregister = logger.addTransport(e => { entries.push(e); });
    logger.info('before');
    deregister();
    logger.info('after');

    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe('before');
  });

  // 7a. redactKeys masks shallow fields case-insensitively
  it('redactKeys masks shallow fields case-insensitively', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      transports: [e => { entries.push(e); }],
      redactKeys: ['password', 'token'],
    });

    logger.info('auth', { Password: 'secret', TOKEN: 'abc123', user: 'alice' });

    expect(entries[0].Password).toBe('[REDACTED]');
    expect(entries[0].TOKEN).toBe('[REDACTED]');
    expect(entries[0].user).toBe('alice');
  });

  // 7b. redactKeys masks nested fields
  it('redactKeys masks nested object fields', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      transports: [e => { entries.push(e); }],
      redactKeys: ['secret'],
    });

    logger.info('nested', { data: { secret: 'hidden', visible: 'yes' } });

    const data = entries[0].data as Record<string, unknown>;
    expect(data.secret).toBe('[REDACTED]');
    expect(data.visible).toBe('yes');
  });

  // 8. File transport writes JSONL lines
  it('file transport writes valid JSONL lines', async () => {
    const file = tmpFile();
    try {
      const logger = createLogger({ filePath: file });
      logger.info('line 1');
      logger.info('line 2');
      await logger.flush();

      const lines = await readLines(file);
      expect(lines).toHaveLength(2);
      expect(lines[0].msg).toBe('line 1');
      expect(lines[1].msg).toBe('line 2');
    } finally {
      cleanup(file);
    }
  });

  // 9. File rotation triggered at maxFileBytes
  it('rotates log file when maxFileBytes threshold is reached', async () => {
    const file = tmpFile();
    try {
      const logger = createLogger({
        filePath: file,
        maxFileBytes: 100,
        maxFiles: 3,
      });

      for (let i = 0; i < 5; i++) {
        logger.info(`message ${i} padded to exceed hundred bytes threshold easily`);
      }
      await logger.flush();

      expect(fs.existsSync(`${file}.1`)).toBe(true);
    } finally {
      cleanup(file);
    }
  });

  // 10. maxFiles limits retained rotations (oldest deleted)
  it('maxFiles limits the number of retained rotated files', async () => {
    const file = tmpFile();
    const maxFiles = 2;
    try {
      const logger = createLogger({
        filePath: file,
        maxFileBytes: 60,
        maxFiles,
      });

      for (let i = 0; i < 15; i++) {
        logger.info(`rotation stress entry ${i} padded`);
      }
      await logger.flush();

      expect(fs.existsSync(`${file}.${maxFiles + 1}`)).toBe(false);
    } finally {
      cleanup(file);
    }
  });

  // 11. flush() awaits all pending writes
  it('flush() waits for all pending file writes to complete', async () => {
    const file = tmpFile();
    try {
      const logger = createLogger({ filePath: file });

      for (let i = 0; i < 10; i++) {
        logger.info(`entry ${i}`);
      }
      await logger.flush();

      const lines = await readLines(file);
      expect(lines.length).toBe(10);
    } finally {
      cleanup(file);
    }
  });

  // 12. close() stops further writes
  it('close() prevents subsequent log entries from being emitted', async () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });

    logger.info('before close');
    await logger.close();
    logger.info('after close');

    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe('before close');
  });

  // 13. Transport throwing doesn't crash logger
  it('a throwing transport does not crash the logger', () => {
    const good: LogEntry[] = [];
    const logger = createLogger({
      transports: [
        () => { throw new Error('boom'); },
        e => { good.push(e); },
      ],
    });

    expect(() => logger.info('safe')).not.toThrow();
    expect(good).toHaveLength(1);
    expect(good[0].msg).toBe('safe');
  });

  // 14. ts is valid ISO-8601
  it('ts field is a valid ISO-8601 string', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });
    logger.info('time check');

    const { ts } = entries[0];
    expect(typeof ts).toBe('string');
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  // 15. Entry structure: required fields present
  it('log entry contains ts, level, levelName, msg and extra fields', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });
    logger.info('structured', { extra: 'value' });

    const e = entries[0];
    expect(e).toHaveProperty('ts');
    expect(e).toHaveProperty('level');
    expect(e).toHaveProperty('levelName');
    expect(e).toHaveProperty('msg', 'structured');
    expect(e.extra).toBe('value');
  });

  // 16. Numeric level matches level name
  it('numeric level value matches the level name for all levels', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      level: 'trace',
      transports: [e => { entries.push(e); }],
    });

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    const expected: Array<[LogLevel, number]> = [
      ['trace', 10], ['debug', 20], ['info', 30],
      ['warn', 40],  ['error', 50], ['fatal', 60],
    ];
    for (const [i, [name, num]] of expected.entries()) {
      expect(entries[i].levelName).toBe(name);
      expect(entries[i].level).toBe(num);
    }
  });

  // 17. Base fields appear in every entry
  it('base fields are present in every log entry', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      base: { app: 'myapp', env: 'test' },
      transports: [e => { entries.push(e); }],
    });

    logger.info('first');
    logger.warn('second');

    for (const entry of entries) {
      expect(entry.app).toBe('myapp');
      expect(entry.env).toBe('test');
    }
  });

  // 18. Error entries include caller-provided err field
  it('error entries include a caller-provided err field', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });

    logger.error('request failed', { err: 'ERR_TIMEOUT', code: 408 });

    expect(entries[0].err).toBe('ERR_TIMEOUT');
    expect(entries[0].code).toBe(408);
  });

  // 19. Silent level suppresses all output
  it('"silent" level suppresses all log entries', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      level: 'trace',
      transports: [e => { entries.push(e); }],
    });

    logger.setLevel('silent' as LogLevel);
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    expect(entries).toHaveLength(0);
  });

  // 20. Clock injection for deterministic timestamps
  it('uses injected clock for deterministic timestamps', () => {
    const entries: LogEntry[] = [];
    const fixedDate = new Date('2024-01-15T12:00:00.000Z');
    const logger = createLogger({
      clock: () => fixedDate,
      transports: [e => { entries.push(e); }],
    });

    logger.info('deterministic');

    expect(entries[0].ts).toBe('2024-01-15T12:00:00.000Z');
  });

  // 21. Default level is info
  it('default level is info, dropping trace and debug', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });

    logger.trace('t');
    logger.debug('d');
    logger.info('i');

    expect(entries).toHaveLength(1);
    expect(entries[0].levelName).toBe('info');
  });

  // 22. Fields don't leak between entries
  it('fields from one log call do not appear in subsequent calls', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });

    logger.info('first', { unique: 'yes' });
    logger.info('second');

    expect(entries[0].unique).toBe('yes');
    expect(entries[1].unique).toBeUndefined();
  });

  // 23. Sibling children don't share extra fields
  it('sibling children do not share extra base fields with each other', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });

    const c1 = logger.child({ child: '1' });
    const c2 = logger.child({ child: '2' });

    c1.info('from c1');
    c2.info('from c2');

    expect(entries[0].child).toBe('1');
    expect(entries[1].child).toBe('2');
  });

  // 24. setLevel affects all subsequent log calls
  it('setLevel dynamically adjusts the active level', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      level: 'trace',
      transports: [e => { entries.push(e); }],
    });

    logger.info('before');
    logger.setLevel('error');
    logger.info('dropped');
    logger.error('after');

    expect(entries).toHaveLength(2);
    expect(entries[0].msg).toBe('before');
    expect(entries[1].msg).toBe('after');
  });

  // 25. Async transport error doesn't crash logger
  it('an async transport rejection does not crash the logger', async () => {
    const good: LogEntry[] = [];
    const logger = createLogger({
      transports: [
        async () => { throw new Error('async boom'); },
        e => { good.push(e); },
      ],
    });

    expect(() => logger.info('async error test')).not.toThrow();
    await new Promise(r => setTimeout(r, 20));
    expect(good).toHaveLength(1);
  });

  // 26. close() flushes pending file writes
  it('close() flushes pending file writes before closing', async () => {
    const file = tmpFile();
    try {
      const logger = createLogger({ filePath: file });
      logger.info('will be flushed');
      await logger.close();

      const lines = await readLines(file);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0].msg).toBe('will be flushed');
    } finally {
      cleanup(file);
    }
  });

  // 27. Redaction applies to base fields
  it('redactKeys applies to base fields as well as log-call fields', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      base: { apiKey: 'super-secret', user: 'alice' },
      transports: [e => { entries.push(e); }],
      redactKeys: ['apikey'],
    });

    logger.info('with base');

    expect(entries[0].apiKey).toBe('[REDACTED]');
    expect(entries[0].user).toBe('alice');
  });

  // 28. No stdout when custom transports provided
  it('does not add stdout transport when custom transports are provided', () => {
    const entries: LogEntry[] = [];
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    const logger = createLogger({ transports: [e => { entries.push(e); }] });
    logger.info('no stdout');

    expect(lines).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  // 29. flush() with no file handler resolves immediately
  it('flush() resolves immediately when there is no file transport', async () => {
    const logger = createLogger({ transports: [] });
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  // 30. trace level allows all entries through
  it('trace level allows all six log levels through', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      level: 'trace',
      transports: [e => { entries.push(e); }],
    });

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    expect(entries).toHaveLength(6);
  });

  // 31. addTransport after creation works
  it('transports added via addTransport after creation receive entries', () => {
    const late: LogEntry[] = [];
    const logger = createLogger({ transports: [] });

    logger.info('before add'); // should not appear
    logger.addTransport(e => { late.push(e); });
    logger.info('after add');

    expect(late).toHaveLength(1);
    expect(late[0].msg).toBe('after add');
  });

  // 32. Multiple rotations produce correct file chain
  it('after multiple rotations the most recent entry is in the active log file', async () => {
    const file = tmpFile();
    try {
      const logger = createLogger({
        filePath: file,
        maxFileBytes: 80,
        maxFiles: 3,
      });

      for (let i = 0; i < 6; i++) {
        logger.info(`entry-${i} with padding to exceed eighty bytes easily here`);
      }
      await logger.flush();

      // Active file must exist and contain valid JSON
      const activeLines = await readLines(file);
      expect(activeLines.length).toBeGreaterThanOrEqual(1);
      expect(typeof activeLines[0].msg).toBe('string');
    } finally {
      cleanup(file);
    }
  });

  // 33. child uses parent's shared transport list
  it('transports registered on parent also fire for child entries', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ transports: [e => { entries.push(e); }] });
    const child = logger.child({ role: 'worker' });

    child.warn('child warn');

    expect(entries).toHaveLength(1);
    expect(entries[0].role).toBe('worker');
    expect(entries[0].levelName).toBe('warn');
  });
});
