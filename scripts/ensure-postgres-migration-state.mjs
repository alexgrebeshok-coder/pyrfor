#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[postgres-migrations] ${message}`);
}

function resolveDatabaseUrl() {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    ""
  );
}

function resolveDirectUrl(databaseUrl) {
  return (
    process.env.DIRECT_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    databaseUrl
  );
}

function getBaselineMigrationName() {
  const migrationRoot = path.join(projectRoot, "prisma", "migrations");
  const entries = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const baseline = entries[0];
  if (!baseline) {
    fail("No Postgres baseline migration directory was found in prisma/migrations.");
  }

  return baseline;
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
}

function runPrisma(args) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  run(command, ["prisma", ...args]);
}

function runNodeScript(relativePath) {
  run(process.execPath, [path.join(projectRoot, relativePath)]);
}

async function loadDatabaseState(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        '_prisma_migrations',
        'Project',
        'Task',
        'Risk',
        'Document',
        'TeamMember',
        'Notification',
        'Column',
        'TaskDependency',
        '_ProjectToTeamMember'
      )
  `);

  const tableNames = new Set(rows.map((row) => row.table_name));
  tableNames.delete("_prisma_migrations");

  return {
    hasMigrationsTable: rows.some((row) => row.table_name === "_prisma_migrations"),
    runtimeTableCount: tableNames.size,
  };
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  fail(
    "A Postgres database URL is required. Checked DATABASE_URL, POSTGRES_PRISMA_URL and POSTGRES_URL."
  );
}

if (!(databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))) {
  fail("Postgres migration bootstrap only supports postgres:// or postgresql:// URLs.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = resolveDirectUrl(databaseUrl);

const prisma = new PrismaClient();
const baselineMigrationName = getBaselineMigrationName();

try {
  const state = await loadDatabaseState(prisma);

  if (!state.hasMigrationsTable && state.runtimeTableCount > 0) {
    log(
      `Legacy Postgres schema detected without _prisma_migrations. Repairing runtime schema and marking baseline '${baselineMigrationName}' as applied.`
    );
    runNodeScript("scripts/repair-production-schema.mjs");
    runNodeScript("scripts/check-production-db-readiness.mjs");
    runPrisma(["migrate", "resolve", "--applied", baselineMigrationName]);
  } else if (!state.hasMigrationsTable) {
    log(`Fresh Postgres database detected. Applying baseline '${baselineMigrationName}'.`);
  } else {
    log("_prisma_migrations table already present. Applying any pending Postgres migrations.");
  }

  runPrisma(["migrate", "deploy"]);
  runNodeScript("scripts/repair-production-schema.mjs");
  runNodeScript("scripts/check-production-db-readiness.mjs");
  log("Postgres migration state is ready.");
} catch (error) {
  const message = error instanceof Error && error.message ? error.message : String(error);
  fail(message);
} finally {
  await prisma.$disconnect();
}
