/**
 * Structured Logger — replaces console.* in server/AI code
 * Controlled by LOG_LEVEL env var: debug | info | warn | error | silent
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
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  return env && env in LEVELS ? env : (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[getLevel()];
}

function format(level: string, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

export const logger = {
  debug(msg: string, meta?: unknown): void {
    if (shouldLog('debug')) console.debug(format('debug', msg, meta));
  },
  info(msg: string, meta?: unknown): void {
    if (shouldLog('info')) console.info(format('info', msg, meta));
  },
  warn(msg: string, meta?: unknown): void {
    if (shouldLog('warn')) console.warn(format('warn', msg, meta));
  },
  error(msg: string, meta?: unknown): void {
    if (shouldLog('error')) console.error(format('error', msg, meta));
  },
};

export default logger;
