/**
 * Pyrfor Daemon — Structured Logger
 *
 * JSON-formatted logging with levels, context, and timestamps.
 * Lightweight replacement for pino/winston for the daemon process.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

let currentLevel: LogLevel =
  (process.env.PYRFOR_LOG_LEVEL as LogLevel) ||
  (process.env.CEOCLAW_LOG_LEVEL as LogLevel) ||
  "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatLog(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const color = LEVEL_COLORS[level];
  const tag = `[${component}]`;

  const base = `${color}${timestamp} ${level.toUpperCase().padEnd(5)}${RESET} ${tag} ${message}`;

  if (data && Object.keys(data).length > 0) {
    const extras = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    return `${base} ${"\x1b[90m"}${extras}${RESET}`;
  }

  return base;
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (shouldLog("debug")) console.log(formatLog("debug", component, message, data));
    },
    info(message: string, data?: Record<string, unknown>) {
      if (shouldLog("info")) console.log(formatLog("info", component, message, data));
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (shouldLog("warn")) console.warn(formatLog("warn", component, message, data));
    },
    error(message: string, data?: Record<string, unknown>) {
      if (shouldLog("error")) console.error(formatLog("error", component, message, data));
    },
  };
}
