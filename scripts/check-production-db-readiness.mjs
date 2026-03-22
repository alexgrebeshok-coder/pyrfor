#!/usr/bin/env node

import { Prisma, PrismaClient } from "@prisma/client";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function getResolvedDatabaseUrl() {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    ""
  );
}

function getResolvedDirectUrl(databaseUrl) {
  return (
    process.env.DIRECT_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    databaseUrl
  );
}

const databaseUrl = getResolvedDatabaseUrl();
const directUrl = getResolvedDirectUrl(databaseUrl);

if (!databaseUrl) {
  fail(
    "A Postgres database URL is required for the production Prisma schema. Checked DATABASE_URL, POSTGRES_PRISMA_URL and POSTGRES_URL."
  );
}

if (!(databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))) {
  fail("Production database readiness checks require a Postgres database URL.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = directUrl;

const prisma = new PrismaClient();

async function probeRuntimeSchema() {
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

  const joinRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_ProjectToTeamMember'
      ) AS "exists"
    `
  );

  if (!joinRows[0]?.exists) {
    throw Object.assign(
      new Error("The table `_ProjectToTeamMember` does not exist in the current database."),
      { code: "P2021" }
    );
  }
}

try {
  await probeRuntimeSchema();

  console.log("✅ Production database readiness OK.");
} catch (error) {
  const message =
    error instanceof Error && error.message.trim() ? error.message : "Unknown Prisma error.";

  fail(
    `Production database is reachable but CEOClaw schema is not ready for runtime.\n${message}`
  );
} finally {
  await prisma.$disconnect();
}
