import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/server/runtime-mode";

export type BriefDeliveryChannel = "telegram" | "email";
export type BriefDeliveryMode = "manual" | "scheduled";
export type BriefDeliveryScope = "governance" | "portfolio" | "project" | "work_report";
export type BriefDeliveryLedgerStatus = "pending" | "preview" | "delivered" | "failed";
export type BriefDeliveryRetryPosture = "preview_only" | "sealed" | "retryable";

export interface BriefDeliveryLedgerRecord {
  id: string;
  channel: BriefDeliveryChannel;
  provider: string;
  mode: BriefDeliveryMode;
  scope: BriefDeliveryScope;
  projectId: string | null;
  projectName: string | null;
  locale: string;
  target: string | null;
  headline: string;
  idempotencyKey: string;
  scheduledPolicyId: string | null;
  status: BriefDeliveryLedgerStatus;
  retryPosture: BriefDeliveryRetryPosture;
  attemptCount: number;
  dryRun: boolean;
  providerMessageId: string | null;
  contentHash: string;
  lastError: string | null;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BriefDeliveryExecutionInput {
  channel: BriefDeliveryChannel;
  provider: string;
  mode: BriefDeliveryMode;
  scope: BriefDeliveryScope;
  projectId?: string | null;
  projectName?: string | null;
  locale: string;
  target?: string | null;
  headline: string;
  content: Record<string, string | null | undefined>;
  requestPayload: Record<string, unknown>;
  dryRun?: boolean;
  idempotencyKey?: string | null;
  scheduledPolicyId?: string | null;
  env?: NodeJS.ProcessEnv;
  execute?: () => Promise<{
    providerMessageId?: string | number | null;
    providerPayload?: unknown;
  }>;
}

export interface BriefDeliveryExecutionOutcome {
  ledger: BriefDeliveryLedgerRecord | null;
  replayed: boolean;
  providerMessageId: string | null;
}

export interface BriefDeliveryLedgerQuery {
  limit?: number;
  scheduledPolicyId?: string;
  scope?: BriefDeliveryScope;
}

type DeliveryLedgerRow = {
  id: string;
  channel: string;
  provider: string;
  mode: string;
  scope: string;
  projectId: string | null;
  projectName: string | null;
  locale: string;
  target: string | null;
  headline: string;
  idempotencyKey: string;
  scheduledPolicyId: string | null;
  status: string;
  retryPosture: string;
  attemptCount: number;
  dryRun: boolean;
  providerMessageId: string | null;
  contentHash: string;
  requestJson: string;
  responseJson: string | null;
  lastError: string | null;
  firstAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const STALE_PENDING_WINDOW_MS = 60_000;

function createContentHash(content: Record<string, string | null | undefined>) {
  return createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
}

function normalizeOptionalString(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isPrismaUniqueError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isPendingLedgerStale(row: DeliveryLedgerRow, now: Date) {
  if (row.status !== "pending" || !row.lastAttemptAt) {
    return false;
  }

  return now.getTime() - row.lastAttemptAt.getTime() > STALE_PENDING_WINDOW_MS;
}

function serializeLedger(row: DeliveryLedgerRow): BriefDeliveryLedgerRecord {
  return {
    id: row.id,
    channel: row.channel as BriefDeliveryChannel,
    provider: row.provider,
    mode: row.mode as BriefDeliveryMode,
    scope: row.scope as BriefDeliveryScope,
    projectId: row.projectId,
    projectName: row.projectName,
    locale: row.locale,
    target: row.target,
    headline: row.headline,
    idempotencyKey: row.idempotencyKey,
    scheduledPolicyId: row.scheduledPolicyId,
    status: row.status as BriefDeliveryLedgerStatus,
    retryPosture: row.retryPosture as BriefDeliveryRetryPosture,
    attemptCount: row.attemptCount,
    dryRun: row.dryRun,
    providerMessageId: row.providerMessageId,
    contentHash: row.contentHash,
    lastError: row.lastError,
    firstAttemptAt: row.firstAttemptAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildFallbackIdempotencyKey(input: {
  channel: BriefDeliveryChannel;
  mode: BriefDeliveryMode;
  scope: BriefDeliveryScope;
  projectId?: string | null;
  locale: string;
  target?: string | null;
  contentHash: string;
  scheduledPolicyId?: string | null;
}) {
  return [
    input.mode,
    input.channel,
    input.scope,
    input.projectId ?? "portfolio",
    input.locale,
    input.target ?? "default-target",
    input.scheduledPolicyId ?? "manual",
    input.contentHash,
  ].join(":");
}

export function buildScheduledBriefDeliveryIdempotencyKey(input: {
  channel: BriefDeliveryChannel;
  policyId: string;
  windowKey: string;
}) {
  return `scheduled:${input.channel}:${input.policyId}:${input.windowKey}`;
}

export async function executeBriefDelivery(input: BriefDeliveryExecutionInput) {
  const env = input.env ?? process.env;
  const target = normalizeOptionalString(input.target);
  const projectId = normalizeOptionalString(input.projectId);
  const projectName = normalizeOptionalString(input.projectName);
  const scheduledPolicyId = normalizeOptionalString(input.scheduledPolicyId);
  const dryRun = input.dryRun ?? false;
  const contentHash = createContentHash(input.content);
  const idempotencyKey =
    normalizeOptionalString(input.idempotencyKey) ??
    buildFallbackIdempotencyKey({
      channel: input.channel,
      mode: input.mode,
      scope: input.scope,
      projectId,
      locale: input.locale,
      target,
      contentHash,
      scheduledPolicyId,
    });

  if (!isDatabaseConfigured(env)) {
    if (dryRun) {
      return {
        ledger: null,
        replayed: false,
        providerMessageId: null,
      } satisfies BriefDeliveryExecutionOutcome;
    }

    if (!input.execute) {
      throw new Error("execute callback is required for non-dry delivery.");
    }

    const result = await input.execute();
    return {
      ledger: null,
      replayed: false,
      providerMessageId: normalizeOptionalString(String(result.providerMessageId ?? "")),
    } satisfies BriefDeliveryExecutionOutcome;
  }

  const requestJson = JSON.stringify({
    ...input.requestPayload,
    idempotencyKey,
    scheduledPolicyId,
  });
  const now = new Date();

  const existing = await prisma.deliveryLedger.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    const replayable =
      existing.status === "delivered" ||
      existing.status === "preview" ||
      (existing.status === "pending" && !isPendingLedgerStale(existing, now));

    if (replayable) {
      return {
        ledger: serializeLedger(existing),
        replayed: true,
        providerMessageId: existing.providerMessageId,
      } satisfies BriefDeliveryExecutionOutcome;
    }
  }

  const seededRow = {
    id: randomUUID(),
    channel: input.channel,
    provider: input.provider,
    mode: input.mode,
    scope: input.scope,
    projectId,
    projectName,
    locale: input.locale,
    target,
    headline: input.headline,
    idempotencyKey,
    scheduledPolicyId,
    dryRun,
    contentHash,
    requestJson,
    updatedAt: now,
  };

  let ledger = existing;

  if (!ledger) {
    try {
      ledger = await prisma.deliveryLedger.create({
        data: {
          ...seededRow,
          status: dryRun ? "preview" : "pending",
          retryPosture: dryRun ? "preview_only" : "retryable",
          attemptCount: dryRun ? 0 : 1,
          firstAttemptAt: dryRun ? null : now,
          lastAttemptAt: dryRun ? null : now,
        },
      });
    } catch (error) {
      if (!isPrismaUniqueError(error)) {
        throw error;
      }

      const concurrent = await prisma.deliveryLedger.findUnique({
        where: { idempotencyKey },
      });
      if (!concurrent) {
        throw error;
      }

      return {
        ledger: serializeLedger(concurrent),
        replayed: true,
        providerMessageId: concurrent.providerMessageId,
      } satisfies BriefDeliveryExecutionOutcome;
    }
  } else if (dryRun) {
    ledger = await prisma.deliveryLedger.update({
      where: { id: ledger.id },
      data: {
        ...seededRow,
        status: "preview",
        retryPosture: "preview_only",
        dryRun: true,
      },
    });
  } else {
    ledger = await prisma.deliveryLedger.update({
      where: { id: ledger.id },
      data: {
        ...seededRow,
        status: "pending",
        retryPosture: "retryable",
        dryRun: false,
        attemptCount: {
          increment: 1,
        },
        ...(ledger.firstAttemptAt ? {} : { firstAttemptAt: now }),
        lastAttemptAt: now,
        lastError: null,
      },
    });
  }

  if (dryRun) {
    return {
      ledger: serializeLedger(ledger),
      replayed: false,
      providerMessageId: ledger.providerMessageId,
    } satisfies BriefDeliveryExecutionOutcome;
  }

  if (!input.execute) {
    throw new Error("execute callback is required for non-dry delivery.");
  }

  try {
    const providerResult = await input.execute();
    const providerMessageId = normalizeOptionalString(
      providerResult.providerMessageId === undefined || providerResult.providerMessageId === null
        ? null
        : String(providerResult.providerMessageId)
    );
    const deliveredAt = new Date();

    const completed = await prisma.deliveryLedger.update({
      where: { id: ledger.id },
      data: {
        status: "delivered",
        retryPosture: "sealed",
        providerMessageId,
        responseJson: JSON.stringify(providerResult.providerPayload ?? {}),
        lastError: null,
        deliveredAt,
        lastAttemptAt: deliveredAt,
      },
    });

    return {
      ledger: serializeLedger(completed),
      replayed: false,
      providerMessageId: completed.providerMessageId,
    } satisfies BriefDeliveryExecutionOutcome;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Brief delivery failed with an unknown error.";

    await prisma.deliveryLedger.update({
      where: { id: ledger.id },
      data: {
        status: "failed",
        retryPosture: "retryable",
        responseJson: JSON.stringify({ error: message }),
        lastError: message,
        lastAttemptAt: new Date(),
      },
    });

    throw error;
  }
}

export async function listBriefDeliveryLedger(query: BriefDeliveryLedgerQuery = {}) {
  if (!isDatabaseConfigured()) {
    return [] as BriefDeliveryLedgerRecord[];
  }

  const rows = await prisma.deliveryLedger.findMany({
    where: {
      ...(query.scheduledPolicyId ? { scheduledPolicyId: query.scheduledPolicyId } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: query.limit ?? 8,
  });

  return rows.map(serializeLedger);
}

export async function listRecentBriefDeliveryLedger(limit = 8) {
  return listBriefDeliveryLedger({ limit });
}
