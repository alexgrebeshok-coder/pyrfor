"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScheduledBriefDeliveryIdempotencyKey = buildScheduledBriefDeliveryIdempotencyKey;
exports.executeBriefDelivery = executeBriefDelivery;
exports.listBriefDeliveryLedger = listBriefDeliveryLedger;
exports.listRecentBriefDeliveryLedger = listRecentBriefDeliveryLedger;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const prisma_1 = require("../prisma");
const runtime_mode_1 = require("../config/runtime-mode");
const STALE_PENDING_WINDOW_MS = 60000;
function createContentHash(content) {
    return (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify(content))
        .digest("hex");
}
function normalizeOptionalString(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function isPrismaUniqueError(error) {
    return (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002");
}
function isPendingLedgerStale(row, now) {
    if (row.status !== "pending" || !row.lastAttemptAt) {
        return false;
    }
    return now.getTime() - row.lastAttemptAt.getTime() > STALE_PENDING_WINDOW_MS;
}
function serializeLedger(row) {
    return {
        id: row.id,
        channel: row.channel,
        provider: row.provider,
        mode: row.mode,
        scope: row.scope,
        projectId: row.projectId,
        projectName: row.projectName,
        locale: row.locale,
        target: row.target,
        headline: row.headline,
        idempotencyKey: row.idempotencyKey,
        scheduledPolicyId: row.scheduledPolicyId,
        status: row.status,
        retryPosture: row.retryPosture,
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
function buildFallbackIdempotencyKey(input) {
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
function buildScheduledBriefDeliveryIdempotencyKey(input) {
    return `scheduled:${input.channel}:${input.policyId}:${input.windowKey}`;
}
async function executeBriefDelivery(input) {
    const env = input.env ?? process.env;
    const target = normalizeOptionalString(input.target);
    const projectId = normalizeOptionalString(input.projectId);
    const projectName = normalizeOptionalString(input.projectName);
    const scheduledPolicyId = normalizeOptionalString(input.scheduledPolicyId);
    const dryRun = input.dryRun ?? false;
    const contentHash = createContentHash(input.content);
    const idempotencyKey = normalizeOptionalString(input.idempotencyKey) ??
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
    if (!(0, runtime_mode_1.isDatabaseConfigured)(env)) {
        if (dryRun) {
            return {
                ledger: null,
                replayed: false,
                providerMessageId: null,
            };
        }
        if (!input.execute) {
            throw new Error("execute callback is required for non-dry delivery.");
        }
        const result = await input.execute();
        return {
            ledger: null,
            replayed: false,
            providerMessageId: normalizeOptionalString(String(result.providerMessageId ?? "")),
        };
    }
    const requestJson = JSON.stringify({
        ...input.requestPayload,
        idempotencyKey,
        scheduledPolicyId,
    });
    const now = new Date();
    const existing = await prisma_1.prisma.deliveryLedger.findUnique({
        where: { idempotencyKey },
    });
    if (existing) {
        const replayable = existing.status === "delivered" ||
            existing.status === "preview" ||
            (existing.status === "pending" && !isPendingLedgerStale(existing, now));
        if (replayable) {
            return {
                ledger: serializeLedger(existing),
                replayed: true,
                providerMessageId: existing.providerMessageId,
            };
        }
    }
    const seededRow = {
        id: (0, node_crypto_1.randomUUID)(),
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
            ledger = await prisma_1.prisma.deliveryLedger.create({
                data: {
                    ...seededRow,
                    status: dryRun ? "preview" : "pending",
                    retryPosture: dryRun ? "preview_only" : "retryable",
                    attemptCount: dryRun ? 0 : 1,
                    firstAttemptAt: dryRun ? null : now,
                    lastAttemptAt: dryRun ? null : now,
                },
            });
        }
        catch (error) {
            if (!isPrismaUniqueError(error)) {
                throw error;
            }
            const concurrent = await prisma_1.prisma.deliveryLedger.findUnique({
                where: { idempotencyKey },
            });
            if (!concurrent) {
                throw error;
            }
            return {
                ledger: serializeLedger(concurrent),
                replayed: true,
                providerMessageId: concurrent.providerMessageId,
            };
        }
    }
    else if (dryRun) {
        ledger = await prisma_1.prisma.deliveryLedger.update({
            where: { id: ledger.id },
            data: {
                ...seededRow,
                status: "preview",
                retryPosture: "preview_only",
                dryRun: true,
            },
        });
    }
    else {
        ledger = await prisma_1.prisma.deliveryLedger.update({
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
        };
    }
    if (!input.execute) {
        throw new Error("execute callback is required for non-dry delivery.");
    }
    try {
        const providerResult = await input.execute();
        const providerMessageId = normalizeOptionalString(providerResult.providerMessageId === undefined || providerResult.providerMessageId === null
            ? null
            : String(providerResult.providerMessageId));
        const deliveredAt = new Date();
        const completed = await prisma_1.prisma.deliveryLedger.update({
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
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Brief delivery failed with an unknown error.";
        await prisma_1.prisma.deliveryLedger.update({
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
async function listBriefDeliveryLedger(query = {}) {
    if (!(0, runtime_mode_1.isDatabaseConfigured)()) {
        return [];
    }
    const rows = await prisma_1.prisma.deliveryLedger.findMany({
        where: {
            ...(query.scheduledPolicyId ? { scheduledPolicyId: query.scheduledPolicyId } : {}),
            ...(query.scope ? { scope: query.scope } : {}),
            ...(query.channel ? { channel: query.channel } : {}),
            ...(query.projectId ? { projectId: query.projectId } : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: query.limit ?? 8,
    });
    return rows.map(serializeLedger);
}
async function listRecentBriefDeliveryLedger(limit = 8) {
    return listBriefDeliveryLedger({ limit });
}
