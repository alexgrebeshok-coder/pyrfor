import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  userId?: string;
  message: string;
  error?: string;
  meta?: Record<string, unknown>;
}

/* eslint-disable no-console */
function emit(entry: LogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Extract or generate a request ID from the incoming request.
 * Checks standard headers first, falls back to a new UUID.
 */
export function getRequestId(request: NextRequest): string {
  return (
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    randomUUID()
  );
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Structured logger for API routes.
 *
 * Usage:
 *   const log = createRequestLogger(request);
 *   log.info("Processing payment", { amount: 100 });
 *   // ... do work ...
 *   log.complete(200);
 */
export function createRequestLogger(request: NextRequest, userId?: string) {
  const requestId = getRequestId(request);
  const method = request.method;
  const path = new URL(request.url).pathname;
  const start = Date.now();

  function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    emit({
      timestamp: new Date().toISOString(),
      level,
      requestId,
      method,
      path,
      userId,
      message,
      ...(meta ? { meta } : {}),
    });
  }

  return {
    requestId,

    info(message: string, meta?: Record<string, unknown>) {
      log("info", message, meta);
    },

    warn(message: string, meta?: Record<string, unknown>) {
      log("warn", message, meta);
    },

    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
      const errorStr = error instanceof Error ? error.message : String(error ?? "");
      emit({
        timestamp: new Date().toISOString(),
        level: "error",
        requestId,
        method,
        path,
        userId,
        message,
        error: errorStr,
        ...(meta ? { meta } : {}),
      });
    },

    debug(message: string, meta?: Record<string, unknown>) {
      if (process.env.NODE_ENV !== "production") {
        log("debug", message, meta);
      }
    },

    /** Log request completion with status and duration. */
    complete(status: number, meta?: Record<string, unknown>) {
      const durationMs = Date.now() - start;
      emit({
        timestamp: new Date().toISOString(),
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        requestId,
        method,
        path,
        status,
        durationMs,
        userId,
        message: `${method} ${path} ${status} ${durationMs}ms`,
        ...(meta ? { meta } : {}),
      });
    },
  };
}
