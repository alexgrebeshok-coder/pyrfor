import { prisma } from "@/lib/prisma";

export const DATABASE_SCHEMA_UNAVAILABLE_MESSAGE =
  "CEOClaw database schema is not ready. Required tables are missing or out of date.";
export const DATABASE_CONNECTION_UNAVAILABLE_MESSAGE =
  "CEOClaw cannot reach the configured database.";

export interface DatabaseReadinessCheck {
  status: "connected" | "error";
  message?: string;
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = error.code;
  return typeof code === "string" ? code : null;
}

export function isPrismaSchemaMissingError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "P2021" || code === "P2022";
}

export function isDatabaseConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /Unable to open the database file/i.test(error.message) ||
    /Can't reach database server/i.test(error.message) ||
    /Authentication failed against database server/i.test(error.message) ||
    /Environment variable not found: DATABASE_URL/i.test(error.message)
  );
}

export function getDatabaseReadinessErrorMessage(error: unknown): string {
  if (isPrismaSchemaMissingError(error)) {
    return DATABASE_SCHEMA_UNAVAILABLE_MESSAGE;
  }

  if (isDatabaseConnectionError(error)) {
    return DATABASE_CONNECTION_UNAVAILABLE_MESSAGE;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Database check failed.";
}

export async function probeDatabaseReadiness(
  probe: () => Promise<unknown> = () =>
    prisma.project.findFirst({
      select: { id: true },
    })
): Promise<DatabaseReadinessCheck> {
  try {
    await probe();

    return {
      status: "connected",
    };
  } catch (error) {
    return {
      status: "error",
      message: getDatabaseReadinessErrorMessage(error),
    };
  }
}
