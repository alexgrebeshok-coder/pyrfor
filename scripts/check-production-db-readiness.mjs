#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

if (!databaseUrl) {
  fail(
    "DATABASE_URL is required for the production Prisma schema. POSTGRES_PRISMA_URL alone is not enough for the current build path."
  );
}

if (!(databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))) {
  fail("Production database readiness checks require a Postgres DATABASE_URL.");
}

const prisma = new PrismaClient();

try {
  await prisma.project.findFirst({
    select: { id: true },
  });

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
