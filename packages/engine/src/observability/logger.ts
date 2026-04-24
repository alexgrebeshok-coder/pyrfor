/* eslint-disable no-console */
/**
 * Structured Logger — replaces console.* in server/AI code
 *
 * Level control (highest priority wins):
 *   PYRFOR_LOG_LEVEL=debug|info|warn|error|silent
 *   LOG_LEVEL=debug|info|warn|error|silent  (legacy fallback)
 *   Default: 'debug' in non-production, 'info' in production.
 *
 * Output format:
 *   PYRFOR_LOG_FORMAT=json  → one JSON object per line:
 *     {"ts":"<ISO>","level":"info","msg":"<message>","data":{...optional}}
 *   PYRFOR_LOG_FORMAT=text (default) → pretty text output (unchanged behaviour).
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 99,
};

function getLevel(): LogLevel {
  const env = (process.env.PYRFOR_LOG_LEVEL ?? process.env.LOG_LEVEL) as LogLevel | undefined;
  return env && env in LEVELS ? env : (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
}

function getFormat(): 'text' | 'json' {
  return process.env.PYRFOR_LOG_FORMAT === 'json' ? 'json' : 'text';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[getLevel()];
}

function formatText(level: string, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

function formatJson(level: LogLevel, msg: string, meta?: unknown): string {
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (meta !== undefined) entry.data = meta;
  return JSON.stringify(entry);
}

function emit(
  level: LogLevel,
  consoleMethod: 'debug' | 'info' | 'warn' | 'error',
  msg: string,
  meta?: unknown,
): void {
  if (!shouldLog(level)) return;
  if (getFormat() === 'json') {
    const line = formatJson(level, msg, meta) + '\n';
    // warn/error → stderr to match console behaviour; debug/info → stdout
    if (level === 'warn' || level === 'error') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  } else {
    console[consoleMethod](formatText(level, msg, meta));
  }
}

export const logger = {
  debug(msg: string, meta?: unknown): void {
    emit('debug', 'debug', msg, meta);
  },
  info(msg: string, meta?: unknown): void {
    emit('info', 'info', msg, meta);
  },
  warn(msg: string, meta?: unknown): void {
    emit('warn', 'warn', msg, meta);
  },
  error(msg: string, meta?: unknown): void {
    emit('error', 'error', msg, meta);
  },
};

export default logger;
