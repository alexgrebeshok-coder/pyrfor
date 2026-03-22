import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const DATABASE_SCHEMA_UNAVAILABLE_MESSAGE =
  "CEOClaw database schema is not ready. Required tables are missing or out of date.";
export const DATABASE_CONNECTION_UNAVAILABLE_MESSAGE =
  "CEOClaw cannot reach the configured database.";

export interface DatabaseReadinessCheck {
  status: "connected" | "error";
  message?: string;
}

function getResolvedDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.DATABASE_URL?.trim() ||
    env.POSTGRES_PRISMA_URL?.trim() ||
    env.POSTGRES_URL?.trim() ||
    env.TURSO_DATABASE_URL?.trim() ||
    ""
  );
}

async function assertProjectTeamJoinTableExists() {
  const databaseUrl = getResolvedDatabaseUrl();
  const isPostgres =
    databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

  if (isPostgres) {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_ProjectToTeamMember'
      ) AS "exists"
    `);

    if (rows[0]?.exists) {
      return;
    }
  } else {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = '_ProjectToTeamMember'
      LIMIT 1
    `);

    if (rows.length > 0) {
      return;
    }
  }

  throw Object.assign(
    new Error("The table `_ProjectToTeamMember` does not exist in the current database."),
    { code: "P2021" }
  );
}

async function runDefaultReadinessProbe() {
  await prisma.project.findFirst({
    select: {
      id: true,
      direction: true,
      health: true,
      start: true,
      end: true,
      budgetPlan: true,
      budgetFact: true,
    },
  });

  await prisma.risk.findFirst({
    select: {
      id: true,
      ownerId: true,
      severity: true,
      category: true,
      date: true,
    },
  });

  await prisma.document.findFirst({
    select: {
      id: true,
      title: true,
      filename: true,
      ownerId: true,
    },
  });

  await prisma.teamMember.findFirst({
    select: {
      id: true,
      capacity: true,
      allocated: true,
    },
  });

  await prisma.notification.findFirst({
    select: {
      id: true,
      entityType: true,
      entityId: true,
      readAt: true,
    },
  });

  await prisma.task.findFirst({
    select: {
      id: true,
      order: true,
      columnId: true,
    },
  });

  await prisma.column.findFirst({
    select: {
      id: true,
      title: true,
    },
  });

  await prisma.taskDependency.findFirst({
    select: {
      id: true,
      dependsOnTaskId: true,
    },
  });

  await assertProjectTeamJoinTableExists();
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
  probe: () => Promise<unknown> = runDefaultReadinessProbe
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
