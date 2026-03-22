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
    "A Postgres database URL is required to repair the production schema. Checked DATABASE_URL, POSTGRES_PRISMA_URL and POSTGRES_URL."
  );
}

if (!(databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))) {
  fail("Production schema repair only supports Postgres databases.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = directUrl;

const prisma = new PrismaClient();

async function loadSchemaState() {
  const relevantTables = [
    "Board",
    "Column",
    "Document",
    "Notification",
    "Project",
    "Risk",
    "Task",
    "TaskDependency",
    "TeamMember",
    "_ProjectToTeamMember",
  ];

  const tableRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${Prisma.join(relevantTables)})
    `
  );

  const columnRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${Prisma.join(relevantTables)})
    `
  );

  const indexRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (${Prisma.join(relevantTables)})
    `
  );

  const tables = new Set(tableRows.map((row) => row.table_name));
  const columns = new Map();
  const nullableColumns = new Set();
  const indexes = new Set(indexRows.map((row) => row.indexname));

  for (const row of columnRows) {
    if (!columns.has(row.table_name)) {
      columns.set(row.table_name, new Set());
    }

    columns.get(row.table_name).add(row.column_name);

    if (row.is_nullable === "YES") {
      nullableColumns.add(`${row.table_name}.${row.column_name}`);
    }
  }

  return { tables, columns, indexes, nullableColumns };
}

function hasTable(state, tableName) {
  return state.tables.has(tableName);
}

function hasColumn(state, tableName, columnName) {
  return state.columns.get(tableName)?.has(columnName) ?? false;
}

function hasIndex(state, indexName) {
  return state.indexes.has(indexName);
}

function isColumnNullable(state, tableName, columnName) {
  return state.nullableColumns.has(`${tableName}.${columnName}`);
}

function ensureColumnSet(state, tableName) {
  if (!state.columns.has(tableName)) {
    state.columns.set(tableName, new Set());
  }

  return state.columns.get(tableName);
}

function noteColumnAdded(state, tableName, columnName, isNullable = true) {
  ensureColumnSet(state, tableName).add(columnName);
  const key = `${tableName}.${columnName}`;
  if (isNullable) {
    state.nullableColumns.add(key);
  } else {
    state.nullableColumns.delete(key);
  }
}

function noteColumnRemoved(state, tableName, columnName) {
  state.columns.get(tableName)?.delete(columnName);
  state.nullableColumns.delete(`${tableName}.${columnName}`);
}

function noteTableAdded(state, tableName, columnNames = []) {
  state.tables.add(tableName);
  const set = ensureColumnSet(state, tableName);
  for (const columnName of columnNames) {
    set.add(columnName);
  }
}

function noteIndexAdded(state, indexName) {
  state.indexes.add(indexName);
}

async function executeRepair(appliedRepairs, description, sql, onApplied) {
  console.log(`- ${description}`);
  await prisma.$executeRawUnsafe(sql);
  appliedRepairs.push(description);
  onApplied?.();
}

async function main() {
  const state = await loadSchemaState();
  const appliedRepairs = [];

  if (hasTable(state, "Task") && !hasColumn(state, "Task", "order")) {
    await executeRepair(
      appliedRepairs,
      'Add Task.order for kanban sorting',
      'ALTER TABLE "Task" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;',
      () => noteColumnAdded(state, "Task", "order", false)
    );
  }

  if (hasTable(state, "Task") && !hasColumn(state, "Task", "columnId")) {
    await executeRepair(
      appliedRepairs,
      'Add Task.columnId for kanban placement',
      'ALTER TABLE "Task" ADD COLUMN "columnId" TEXT;',
      () => noteColumnAdded(state, "Task", "columnId")
    );
  }

  if (hasTable(state, "Risk") && !hasColumn(state, "Risk", "ownerId")) {
    if (hasColumn(state, "Risk", "owner")) {
      await executeRepair(
        appliedRepairs,
        'Rename Risk.owner to Risk.ownerId',
        'ALTER TABLE "Risk" RENAME COLUMN "owner" TO "ownerId";',
        () => {
          noteColumnRemoved(state, "Risk", "owner");
          noteColumnAdded(state, "Risk", "ownerId");
        }
      );
    } else {
      await executeRepair(
        appliedRepairs,
        'Add Risk.ownerId',
        'ALTER TABLE "Risk" ADD COLUMN "ownerId" TEXT;',
        () => noteColumnAdded(state, "Risk", "ownerId")
      );
    }
  }

  if (hasTable(state, "Risk") && !hasColumn(state, "Risk", "severity")) {
    await executeRepair(
      appliedRepairs,
      'Add Risk.severity',
      'ALTER TABLE "Risk" ADD COLUMN "severity" INTEGER NOT NULL DEFAULT 3;',
      () => noteColumnAdded(state, "Risk", "severity", false)
    );
  }

  if (hasTable(state, "Risk") && !hasColumn(state, "Risk", "category")) {
    await executeRepair(
      appliedRepairs,
      'Add Risk.category',
      `ALTER TABLE "Risk" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Прочие';`,
      () => noteColumnAdded(state, "Risk", "category", false)
    );
  }

  if (hasTable(state, "Risk") && !hasColumn(state, "Risk", "date")) {
    await executeRepair(
      appliedRepairs,
      'Add Risk.date',
      'ALTER TABLE "Risk" ADD COLUMN "date" TIMESTAMP(3);',
      () => noteColumnAdded(state, "Risk", "date")
    );
  }

  if (hasTable(state, "Document") && !hasColumn(state, "Document", "title")) {
    if (hasColumn(state, "Document", "name")) {
      await executeRepair(
        appliedRepairs,
        'Rename Document.name to Document.title',
        'ALTER TABLE "Document" RENAME COLUMN "name" TO "title";',
        () => {
          noteColumnRemoved(state, "Document", "name");
          noteColumnAdded(state, "Document", "title", false);
        }
      );
    } else {
      await executeRepair(
        appliedRepairs,
        'Add Document.title',
        `ALTER TABLE "Document" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Document';`,
        () => noteColumnAdded(state, "Document", "title", false)
      );
    }
  }

  if (hasTable(state, "Document") && !hasColumn(state, "Document", "ownerId")) {
    if (hasColumn(state, "Document", "uploadedBy")) {
      await executeRepair(
        appliedRepairs,
        'Rename Document.uploadedBy to Document.ownerId',
        'ALTER TABLE "Document" RENAME COLUMN "uploadedBy" TO "ownerId";',
        () => {
          noteColumnRemoved(state, "Document", "uploadedBy");
          noteColumnAdded(state, "Document", "ownerId");
        }
      );
    } else {
      await executeRepair(
        appliedRepairs,
        'Add Document.ownerId',
        'ALTER TABLE "Document" ADD COLUMN "ownerId" TEXT;',
        () => noteColumnAdded(state, "Document", "ownerId")
      );
    }
  }

  if (hasTable(state, "Document") && !hasColumn(state, "Document", "description")) {
    await executeRepair(
      appliedRepairs,
      'Add Document.description',
      'ALTER TABLE "Document" ADD COLUMN "description" TEXT;',
      () => noteColumnAdded(state, "Document", "description")
    );
  }

  if (hasTable(state, "Document") && !hasColumn(state, "Document", "filename")) {
    await executeRepair(
      appliedRepairs,
      'Add Document.filename',
      'ALTER TABLE "Document" ADD COLUMN "filename" TEXT;',
      () => noteColumnAdded(state, "Document", "filename")
    );
  }

  if (
    hasTable(state, "Document") &&
    hasColumn(state, "Document", "filename") &&
    isColumnNullable(state, "Document", "filename")
  ) {
    await executeRepair(
      appliedRepairs,
      'Backfill Document.filename from title',
      `UPDATE "Document"
       SET "filename" = COALESCE(NULLIF("title", ''), 'document')
       WHERE "filename" IS NULL OR "filename" = '';`
    );

    await executeRepair(
      appliedRepairs,
      'Require Document.filename',
      'ALTER TABLE "Document" ALTER COLUMN "filename" SET NOT NULL;',
      () => noteColumnAdded(state, "Document", "filename", false)
    );
  }

  if (hasTable(state, "TeamMember") && !hasColumn(state, "TeamMember", "allocated")) {
    await executeRepair(
      appliedRepairs,
      'Add TeamMember.allocated',
      'ALTER TABLE "TeamMember" ADD COLUMN "allocated" INTEGER NOT NULL DEFAULT 50;',
      () => noteColumnAdded(state, "TeamMember", "allocated", false)
    );
  }

  if (hasTable(state, "Notification") && !hasColumn(state, "Notification", "entityType")) {
    await executeRepair(
      appliedRepairs,
      'Add Notification.entityType',
      'ALTER TABLE "Notification" ADD COLUMN "entityType" TEXT;',
      () => noteColumnAdded(state, "Notification", "entityType")
    );
  }

  if (hasTable(state, "Notification") && !hasColumn(state, "Notification", "entityId")) {
    await executeRepair(
      appliedRepairs,
      'Add Notification.entityId',
      'ALTER TABLE "Notification" ADD COLUMN "entityId" TEXT;',
      () => noteColumnAdded(state, "Notification", "entityId")
    );
  }

  if (hasTable(state, "Notification") && !hasColumn(state, "Notification", "readAt")) {
    await executeRepair(
      appliedRepairs,
      'Add Notification.readAt',
      'ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3);',
      () => noteColumnAdded(state, "Notification", "readAt")
    );
  }

  if (hasTable(state, "Column") && !hasColumn(state, "Column", "title")) {
    if (hasColumn(state, "Column", "name")) {
      await executeRepair(
        appliedRepairs,
        'Rename Column.name to Column.title',
        'ALTER TABLE "Column" RENAME COLUMN "name" TO "title";',
        () => {
          noteColumnRemoved(state, "Column", "name");
          noteColumnAdded(state, "Column", "title", false);
        }
      );
    } else {
      await executeRepair(
        appliedRepairs,
        'Add Column.title',
        `ALTER TABLE "Column" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Untitled';`,
        () => noteColumnAdded(state, "Column", "title", false)
      );
    }
  }

  if (hasTable(state, "TaskDependency") && !hasColumn(state, "TaskDependency", "dependsOnTaskId")) {
    if (hasColumn(state, "TaskDependency", "dependsOnId")) {
      await executeRepair(
        appliedRepairs,
        'Rename TaskDependency.dependsOnId to TaskDependency.dependsOnTaskId',
        'ALTER TABLE "TaskDependency" RENAME COLUMN "dependsOnId" TO "dependsOnTaskId";',
        () => {
          noteColumnRemoved(state, "TaskDependency", "dependsOnId");
          noteColumnAdded(state, "TaskDependency", "dependsOnTaskId", false);
        }
      );
    } else {
      await executeRepair(
        appliedRepairs,
        'Add TaskDependency.dependsOnTaskId',
        'ALTER TABLE "TaskDependency" ADD COLUMN "dependsOnTaskId" TEXT;',
        () => noteColumnAdded(state, "TaskDependency", "dependsOnTaskId")
      );
    }
  }

  if (
    !hasTable(state, "_ProjectToTeamMember") &&
    hasTable(state, "Project") &&
    hasTable(state, "TeamMember")
  ) {
    await executeRepair(
      appliedRepairs,
      'Create _ProjectToTeamMember join table',
      `CREATE TABLE "_ProjectToTeamMember" (
         "A" TEXT NOT NULL,
         "B" TEXT NOT NULL,
         CONSTRAINT "_ProjectToTeamMember_A_fkey"
           FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
         CONSTRAINT "_ProjectToTeamMember_B_fkey"
           FOREIGN KEY ("B") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
       );`,
      () => noteTableAdded(state, "_ProjectToTeamMember", ["A", "B"])
    );
  }

  if (
    hasTable(state, "_ProjectToTeamMember") &&
    !hasIndex(state, "_ProjectToTeamMember_AB_unique")
  ) {
    await executeRepair(
      appliedRepairs,
      'Create _ProjectToTeamMember uniqueness index',
      'CREATE UNIQUE INDEX IF NOT EXISTS "_ProjectToTeamMember_AB_unique" ON "_ProjectToTeamMember"("A", "B");',
      () => noteIndexAdded(state, "_ProjectToTeamMember_AB_unique")
    );
  }

  if (
    hasTable(state, "_ProjectToTeamMember") &&
    !hasIndex(state, "_ProjectToTeamMember_B_index")
  ) {
    await executeRepair(
      appliedRepairs,
      'Create _ProjectToTeamMember reverse lookup index',
      'CREATE INDEX IF NOT EXISTS "_ProjectToTeamMember_B_index" ON "_ProjectToTeamMember"("B");',
      () => noteIndexAdded(state, "_ProjectToTeamMember_B_index")
    );
  }

  if (appliedRepairs.length === 0) {
    console.log("✅ No legacy production schema repairs were required.");
    return;
  }

  console.log(`✅ Applied ${appliedRepairs.length} production schema repair step(s).`);
}

main()
  .catch((error) => {
    const message =
      error instanceof Error && error.message.trim() ? error.message : "Unknown schema repair error.";
    fail(`Production schema repair failed.\n${message}`);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
