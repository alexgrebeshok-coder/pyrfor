import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  DATABASE_CONNECTION_UNAVAILABLE_MESSAGE,
  DATABASE_SCHEMA_UNAVAILABLE_MESSAGE,
  isDatabaseConnectionError,
  isPrismaSchemaMissingError,
} from "@/lib/server/database-readiness";
import type { ServerRuntimeState } from "@/lib/server/runtime-mode";

const projectStatusMap: Record<string, string> = {
  active: "active",
  planning: "planning",
  completed: "completed",
  "on-hold": "on_hold",
  on_hold: "on_hold",
  "at-risk": "at_risk",
  at_risk: "at_risk",
};

const taskStatusMap: Record<string, string> = {
  todo: "todo",
  blocked: "blocked",
  done: "done",
  cancelled: "cancelled",
  "in-progress": "in_progress",
  in_progress: "in_progress",
};

const milestoneStatusMap: Record<string, string> = {
  upcoming: "upcoming",
  completed: "completed",
  overdue: "overdue",
  "in-progress": "in_progress",
  in_progress: "in_progress",
};

type APIErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown
): NextResponse<APIErrorPayload> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status }
  );
}

export function badRequest(
  message: string,
  code = "BAD_REQUEST",
  details?: unknown
): NextResponse<APIErrorPayload> {
  return jsonError(400, code, message, details);
}

export function serviceUnavailable(
  message: string,
  code = "SERVICE_UNAVAILABLE",
  details?: unknown
): NextResponse<APIErrorPayload> {
  return jsonError(503, code, message, details);
}

export function databaseUnavailable(dataMode?: string): NextResponse<APIErrorPayload> {
  return serviceUnavailable(
    "DATABASE_URL is not configured for live mode.",
    "DATABASE_UNAVAILABLE",
    dataMode ? { dataMode } : undefined
  );
}

export function databaseSchemaUnavailable(
  message = DATABASE_SCHEMA_UNAVAILABLE_MESSAGE
): NextResponse<APIErrorPayload> {
  return serviceUnavailable(message, "DATABASE_SCHEMA_UNAVAILABLE");
}

export function databaseConnectionUnavailable(
  message = DATABASE_CONNECTION_UNAVAILABLE_MESSAGE
): NextResponse<APIErrorPayload> {
  return serviceUnavailable(message, "DATABASE_CONNECTION_UNAVAILABLE");
}

export function liveOperatorDataUnavailable(
  runtime: Pick<ServerRuntimeState, "dataMode">
): NextResponse<APIErrorPayload> {
  return databaseUnavailable(runtime.dataMode);
}

export function notFound(
  message: string,
  code = "NOT_FOUND"
): NextResponse<APIErrorPayload> {
  return jsonError(404, code, message);
}

export function forbidden(
  message: string,
  code = "FORBIDDEN"
): NextResponse<APIErrorPayload> {
  return jsonError(403, code, message);
}

export function validationError(error: z.ZodError): NextResponse<APIErrorPayload> {
  return jsonError(400, "VALIDATION_ERROR", "Validation failed", error.flatten());
}

export function serverError(
  error: unknown,
  fallback: string,
  code = "INTERNAL_SERVER_ERROR"
): NextResponse<APIErrorPayload> {
  // P2-5: Log detailed error server-side, return generic message to client
  const detailedMessage =
    error instanceof Error && error.message.trim() ? error.message : fallback;

  // Log full error details for debugging (server-side only)
  console.error("[API Error]", {
    code,
    message: detailedMessage,
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  });

  if (isPrismaSchemaMissingError(error)) {
    return databaseSchemaUnavailable();
  }

  if (isDatabaseConnectionError(error)) {
    return databaseConnectionUnavailable();
  }

  // Return generic message to client (don't leak internal details)
  const clientMessage =
    process.env.NODE_ENV === "development"
      ? detailedMessage
      : "An unexpected error occurred. Please try again later.";

  return jsonError(500, code, clientMessage);
}

export function isPrismaNotFoundError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

export function normalizeProjectStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return projectStatusMap[value.trim()];
}

export function normalizeTaskStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return taskStatusMap[value.trim()];
}

export function normalizeMilestoneStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return milestoneStatusMap[value.trim()];
}

export function parseDateInput(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

export function parseOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function parseOptionalInteger(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) return undefined;
  return Math.round(parsed);
}

export function calculateProjectProgress(input: {
  progress?: number | null;
  tasks?: Array<{ status: string }>;
}): number {
  if (typeof input.progress === "number" && Number.isFinite(input.progress)) {
    return Math.max(0, Math.min(100, Math.round(input.progress)));
  }

  const tasks = input.tasks ?? [];
  if (!tasks.length) return 0;

  const doneCount = tasks.filter((task) => task.status === "done").length;
  return Math.round((doneCount / tasks.length) * 100);
}

export function calculateProjectHealth(input: {
  health?: string | null;
  risks?: Array<{ severity?: number | null; status?: string | null }>;
}): string {
  const openRisks = (input.risks ?? []).filter(
    (risk) => !risk.status || risk.status === "open"
  );

  if (openRisks.some((risk) => (risk.severity ?? 0) >= 5)) {
    return "critical";
  }

  if (openRisks.some((risk) => (risk.severity ?? 0) >= 3)) {
    return "warning";
  }

  return input.health && typeof input.health === "string" ? input.health : "good";
}
