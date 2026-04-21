/**
 * Backfill script — tag legacy AI runs with `workspaceId` / `ownerUserId`.
 *
 * Context
 * -------
 * Wave A introduced workspace isolation in `AIKernelControlPlane`:
 * every new `AIRunInput` persisted via `run.create` is stamped with
 * the caller's `workspaceId` (and `ownerUserId` where available), and
 * `run.get` / `run.list` / `run.apply` enforce that callers only see
 * runs from their own workspace.
 *
 * Runs created before Wave A have no `workspaceId` on their stored
 * `inputJson`. The kernel currently treats such "legacy untagged" runs
 * as accessible to any workspace (with a warning log) for graceful
 * backward compatibility. This script migrates those runs so workspace
 * enforcement becomes universal and the legacy-untagged warning log
 * can be removed in a later wave.
 *
 * Strategy
 * --------
 * For every row in `aiRunLedger`:
 *   1. Parse `inputJson`.
 *   2. If `input.workspaceId` is already set → skip.
 *   3. Otherwise, try to infer the workspace from the linked project
 *      (`aiRunLedger.projectId → Project.workspaceId`).
 *   4. If no project link exists, fall back to `--default-workspace`
 *      (default: `executive`).
 *   5. Write the patched `inputJson` back.
 *
 * Usage
 * -----
 *   npx tsx scripts/backfill-ai-runs-workspace.ts               # dry run
 *   npx tsx scripts/backfill-ai-runs-workspace.ts --apply        # write
 *   npx tsx scripts/backfill-ai-runs-workspace.ts --apply \
 *       --default-workspace executive
 *
 * Safe to re-run: the script is idempotent (rows with `workspaceId`
 * already set are skipped).
 */

import { prisma } from "../lib/db";
import { logger } from "../lib/logger";

interface CliOptions {
  apply: boolean;
  defaultWorkspace: string;
  batchSize: number;
}

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  const opts: CliOptions = {
    apply: false,
    defaultWorkspace: "executive",
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--default-workspace") {
      opts.defaultWorkspace = argv[++i] ?? opts.defaultWorkspace;
    } else if (arg === "--batch-size") {
      opts.batchSize = Number(argv[++i] ?? opts.batchSize) || opts.batchSize;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npx tsx scripts/backfill-ai-runs-workspace.ts [options]",
          "",
          "Options:",
          "  --apply                    write changes (default: dry run)",
          "  --default-workspace <id>   fallback workspaceId when no project link (default: executive)",
          "  --batch-size <n>           rows per page (default: 200)",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return opts;
}

type LedgerRow = Awaited<ReturnType<typeof prisma.aiRunLedger.findMany>>[number];

async function inferWorkspaceId(
  row: LedgerRow,
  projectCache: Map<string, string | null>,
  fallback: string
): Promise<{ workspaceId: string; source: "project" | "fallback" }> {
  if (row.projectId) {
    if (projectCache.has(row.projectId)) {
      const cached = projectCache.get(row.projectId) ?? null;
      if (cached) return { workspaceId: cached, source: "project" };
    } else {
      const project = await prisma.project.findUnique({
        where: { id: row.projectId },
        select: { workspaceId: true },
      });
      projectCache.set(row.projectId, project?.workspaceId ?? null);
      if (project?.workspaceId) {
        return { workspaceId: project.workspaceId, source: "project" };
      }
    }
  }
  return { workspaceId: fallback, source: "fallback" };
}

async function main() {
  const opts = parseArgs();
  logger.info("[Backfill AI runs] starting", {
    apply: opts.apply,
    defaultWorkspace: opts.defaultWorkspace,
    batchSize: opts.batchSize,
  });

  const totalRows = await prisma.aiRunLedger.count();
  logger.info(`[Backfill AI runs] ${totalRows} total ledger rows`);

  let scanned = 0;
  let alreadyTagged = 0;
  let willUpdate = 0;
  let updated = 0;
  let skippedParseError = 0;
  const sources = { project: 0, fallback: 0 };
  const projectCache = new Map<string, string | null>();

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.aiRunLedger.findMany({
      take: opts.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(row.inputJson) as Record<string, unknown>;
      } catch (err) {
        skippedParseError++;
        logger.warn("[Backfill AI runs] malformed inputJson, skipping", {
          runId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (typeof input.workspaceId === "string" && input.workspaceId.length > 0) {
        alreadyTagged++;
        continue;
      }

      const { workspaceId, source } = await inferWorkspaceId(
        row,
        projectCache,
        opts.defaultWorkspace
      );
      sources[source]++;
      willUpdate++;

      if (opts.apply) {
        const patched = { ...input, workspaceId };
        await prisma.aiRunLedger.update({
          where: { id: row.id },
          data: { inputJson: JSON.stringify(patched) },
        });
        updated++;
      }
    }

    cursor = rows[rows.length - 1]!.id;
    logger.info("[Backfill AI runs] progress", {
      scanned,
      alreadyTagged,
      willUpdate,
      updated,
    });
  }

  logger.info("[Backfill AI runs] done", {
    totalRows,
    scanned,
    alreadyTagged,
    willUpdate,
    updated,
    skippedParseError,
    sources,
    dryRun: !opts.apply,
  });

  if (!opts.apply && willUpdate > 0) {
    console.log(
      `\nDry run: ${willUpdate} rows would be updated. Re-run with --apply to persist changes.\n`
    );
  }
}

main()
  .catch((err) => {
    logger.error("[Backfill AI runs] failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
