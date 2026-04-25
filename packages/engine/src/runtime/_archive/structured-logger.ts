/**
 * StructuredLogger — leveled JSON-line logger with file rotation.
 *
 * Levels: trace(10) debug(20) info(30) warn(40) error(50) fatal(60)
 * Special: 'silent' (numeric 100) suppresses all output.
 */

import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  ts: string;
  level: number;
  levelName: LogLevel;
  msg: string;
  [k: string]: unknown;
}

export type LogTransport = (entry: LogEntry) => void | Promise<void>;

export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
  child(extraBase: Record<string, unknown>): Logger;
  setLevel(level: LogLevel): void;
  addTransport(t: LogTransport): () => void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  base?: Record<string, unknown>;
  transports?: LogTransport[];
  filePath?: string;
  maxFileBytes?: number;
  maxFiles?: number;
  clock?: () => Date;
  redactKeys?: string[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const LEVEL_MAP: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function deepRedact(obj: unknown, keys: Set<string>): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => deepRedact(v, keys));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = keys.has(k.toLowerCase()) ? '[REDACTED]' : deepRedact(v, keys);
  }
  return result;
}

// ---------------------------------------------------------------------------
// File rotator
// ---------------------------------------------------------------------------

class FileRotator {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxFileBytes: number,
    private readonly maxFiles: number,
  ) {}

  /** Enqueue a line for writing; errors are swallowed to protect the logger. */
  write(line: string): void {
    this.queue = this.queue
      .then(() => this._doWrite(line))
      .catch(e => console.error('[StructuredLogger] file write error:', e));
  }

  private async _doWrite(line: string): Promise<void> {
    let createNew = false;
    try {
      const stat = await fs.promises.stat(this.filePath);
      if (stat.size >= this.maxFileBytes) {
        await this._rotate();
        createNew = true;
      }
    } catch {
      // File does not exist yet — create it atomically below.
      createNew = true;
    }

    if (createNew) {
      // Atomic create: write to .tmp then rename so readers never see a partial file.
      const tmp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(tmp, line);
      await fs.promises.rename(tmp, this.filePath);
    } else {
      await fs.promises.appendFile(this.filePath, line);
    }
  }

  private async _rotate(): Promise<void> {
    // Delete oldest rotated file beyond maxFiles.
    try { await fs.promises.unlink(`${this.filePath}.${this.maxFiles}`); } catch { /* ok */ }
    // Shift .i → .(i+1), from oldest to newest.
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      try {
        await fs.promises.rename(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`);
      } catch { /* gap is fine */ }
    }
    // Rename current log → .1.
    await fs.promises.rename(this.filePath, `${this.filePath}.1`);
  }

  /** Returns a LogTransport that writes JSON lines to this file. */
  transport(): LogTransport {
    return (entry: LogEntry) => {
      this.write(JSON.stringify(entry) + '\n');
    };
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

// ---------------------------------------------------------------------------
// Shared mutable state (shared by parent + all children)
// ---------------------------------------------------------------------------

interface SharedState {
  levelNum: number;
  transports: LogTransport[];
  fileRotator: FileRotator | null;
  redactKeys: Set<string>;
  clock: () => Date;
  closed: boolean;
}

// ---------------------------------------------------------------------------
// Logger factory (internal)
// ---------------------------------------------------------------------------

function makeLogger(base: Record<string, unknown>, state: SharedState): Logger {
  function log(levelNum: number, levelName: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (state.closed || levelNum < state.levelNum) return;

    const raw: Record<string, unknown> = {
      ...base,
      ...(fields ?? {}),
      ts: state.clock().toISOString(),
      level: levelNum,
      levelName,
      msg,
    };

    const entry = (state.redactKeys.size > 0
      ? deepRedact(raw, state.redactKeys)
      : raw) as LogEntry;

    for (const t of [...state.transports]) {
      try {
        const result = t(entry);
        if (result instanceof Promise) {
          result.catch(e => console.error('[StructuredLogger] async transport error:', e));
        }
      } catch (e) {
        console.error('[StructuredLogger] transport error:', e);
      }
    }
  }

  return {
    trace: (msg, fields) => log(10, 'trace', msg, fields),
    debug: (msg, fields) => log(20, 'debug', msg, fields),
    info:  (msg, fields) => log(30, 'info',  msg, fields),
    warn:  (msg, fields) => log(40, 'warn',  msg, fields),
    error: (msg, fields) => log(50, 'error', msg, fields),
    fatal: (msg, fields) => log(60, 'fatal', msg, fields),

    child(extraBase) {
      return makeLogger({ ...base, ...extraBase }, state);
    },

    setLevel(level) {
      state.levelNum = LEVEL_MAP[level as string] ?? LEVEL_MAP['info'];
    },

    addTransport(t) {
      state.transports.push(t);
      return () => {
        const idx = state.transports.indexOf(t);
        if (idx !== -1) state.transports.splice(idx, 1);
      };
    },

    async flush() {
      if (state.fileRotator) await state.fileRotator.flush();
    },

    async close() {
      if (state.fileRotator) await state.fileRotator.flush();
      state.closed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createLogger(opts?: CreateLoggerOptions): Logger {
  const transports: LogTransport[] = [...(opts?.transports ?? [])];
  let fileRotator: FileRotator | null = null;

  if (opts?.filePath) {
    fileRotator = new FileRotator(
      opts.filePath,
      opts.maxFileBytes ?? 10 * 1024 * 1024,
      opts.maxFiles ?? 5,
    );
    transports.push(fileRotator.transport());
  } else if (transports.length === 0) {
    // Default: write to stdout.
    transports.push((entry: LogEntry) => {
      process.stdout.write(JSON.stringify(entry) + '\n');
    });
  }

  const state: SharedState = {
    levelNum: LEVEL_MAP[opts?.level ?? 'info'],
    transports,
    fileRotator,
    redactKeys: new Set((opts?.redactKeys ?? []).map(k => k.toLowerCase())),
    clock: opts?.clock ?? (() => new Date()),
    closed: false,
  };

  return makeLogger(opts?.base ?? {}, state);
}
