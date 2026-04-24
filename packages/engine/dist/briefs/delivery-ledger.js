var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from '../prisma';
import { isDatabaseConfigured } from '../config/runtime-mode';
const STALE_PENDING_WINDOW_MS = 60000;
function createContentHash(content) {
    return createHash("sha256")
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
    return (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002");
}
function isPendingLedgerStale(row, now) {
    if (row.status !== "pending" || !row.lastAttemptAt) {
        return false;
    }
    return now.getTime() - row.lastAttemptAt.getTime() > STALE_PENDING_WINDOW_MS;
}
function serializeLedger(row) {
    var _a, _b, _c, _d, _e, _f;
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
        firstAttemptAt: (_b = (_a = row.firstAttemptAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
        lastAttemptAt: (_d = (_c = row.lastAttemptAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : null,
        deliveredAt: (_f = (_e = row.deliveredAt) === null || _e === void 0 ? void 0 : _e.toISOString()) !== null && _f !== void 0 ? _f : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
function buildFallbackIdempotencyKey(input) {
    var _a, _b, _c;
    return [
        input.mode,
        input.channel,
        input.scope,
        (_a = input.projectId) !== null && _a !== void 0 ? _a : "portfolio",
        input.locale,
        (_b = input.target) !== null && _b !== void 0 ? _b : "default-target",
        (_c = input.scheduledPolicyId) !== null && _c !== void 0 ? _c : "manual",
        input.contentHash,
    ].join(":");
}
export function buildScheduledBriefDeliveryIdempotencyKey(input) {
    return `scheduled:${input.channel}:${input.policyId}:${input.windowKey}`;
}
export function executeBriefDelivery(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const env = (_a = input.env) !== null && _a !== void 0 ? _a : process.env;
        const target = normalizeOptionalString(input.target);
        const projectId = normalizeOptionalString(input.projectId);
        const projectName = normalizeOptionalString(input.projectName);
        const scheduledPolicyId = normalizeOptionalString(input.scheduledPolicyId);
        const dryRun = (_b = input.dryRun) !== null && _b !== void 0 ? _b : false;
        const contentHash = createContentHash(input.content);
        const idempotencyKey = (_c = normalizeOptionalString(input.idempotencyKey)) !== null && _c !== void 0 ? _c : buildFallbackIdempotencyKey({
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
                };
            }
            if (!input.execute) {
                throw new Error("execute callback is required for non-dry delivery.");
            }
            const result = yield input.execute();
            return {
                ledger: null,
                replayed: false,
                providerMessageId: normalizeOptionalString(String((_d = result.providerMessageId) !== null && _d !== void 0 ? _d : "")),
            };
        }
        const requestJson = JSON.stringify(Object.assign(Object.assign({}, input.requestPayload), { idempotencyKey,
            scheduledPolicyId }));
        const now = new Date();
        const existing = yield prisma.deliveryLedger.findUnique({
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
                ledger = yield prisma.deliveryLedger.create({
                    data: Object.assign(Object.assign({}, seededRow), { status: dryRun ? "preview" : "pending", retryPosture: dryRun ? "preview_only" : "retryable", attemptCount: dryRun ? 0 : 1, firstAttemptAt: dryRun ? null : now, lastAttemptAt: dryRun ? null : now }),
                });
            }
            catch (error) {
                if (!isPrismaUniqueError(error)) {
                    throw error;
                }
                const concurrent = yield prisma.deliveryLedger.findUnique({
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
            ledger = yield prisma.deliveryLedger.update({
                where: { id: ledger.id },
                data: Object.assign(Object.assign({}, seededRow), { status: "preview", retryPosture: "preview_only", dryRun: true }),
            });
        }
        else {
            ledger = yield prisma.deliveryLedger.update({
                where: { id: ledger.id },
                data: Object.assign(Object.assign(Object.assign(Object.assign({}, seededRow), { status: "pending", retryPosture: "retryable", dryRun: false, attemptCount: {
                        increment: 1,
                    } }), (ledger.firstAttemptAt ? {} : { firstAttemptAt: now })), { lastAttemptAt: now, lastError: null }),
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
            const providerResult = yield input.execute();
            const providerMessageId = normalizeOptionalString(providerResult.providerMessageId === undefined || providerResult.providerMessageId === null
                ? null
                : String(providerResult.providerMessageId));
            const deliveredAt = new Date();
            const completed = yield prisma.deliveryLedger.update({
                where: { id: ledger.id },
                data: {
                    status: "delivered",
                    retryPosture: "sealed",
                    providerMessageId,
                    responseJson: JSON.stringify((_e = providerResult.providerPayload) !== null && _e !== void 0 ? _e : {}),
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
            yield prisma.deliveryLedger.update({
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
    });
}
export function listBriefDeliveryLedger() {
    return __awaiter(this, arguments, void 0, function* (query = {}) {
        var _a;
        if (!isDatabaseConfigured()) {
            return [];
        }
        const rows = yield prisma.deliveryLedger.findMany({
            where: Object.assign(Object.assign(Object.assign(Object.assign({}, (query.scheduledPolicyId ? { scheduledPolicyId: query.scheduledPolicyId } : {})), (query.scope ? { scope: query.scope } : {})), (query.channel ? { channel: query.channel } : {})), (query.projectId ? { projectId: query.projectId } : {})),
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            take: (_a = query.limit) !== null && _a !== void 0 ? _a : 8,
        });
        return rows.map(serializeLedger);
    });
}
export function listRecentBriefDeliveryLedger() {
    return __awaiter(this, arguments, void 0, function* (limit = 8) {
        return listBriefDeliveryLedger({ limit });
    });
}
