"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupportedTimeZone = isSupportedTimeZone;
exports.shouldAttemptTelegramPolicy = shouldAttemptTelegramPolicy;
exports.executeTelegramPolicyRun = executeTelegramPolicyRun;
exports.listTelegramBriefDeliveryPolicies = listTelegramBriefDeliveryPolicies;
exports.createTelegramBriefDeliveryPolicy = createTelegramBriefDeliveryPolicy;
exports.updateTelegramBriefDeliveryPolicy = updateTelegramBriefDeliveryPolicy;
exports.runDueTelegramBriefDeliveryPolicies = runDueTelegramBriefDeliveryPolicies;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../prisma");
const delivery_ledger_1 = require("./delivery-ledger");
const telegram_delivery_1 = require("./telegram-delivery");
const locale_1 = require("./locale");
const policyInclude = {
    project: {
        select: {
            id: true,
            name: true,
        },
    },
};
function isSupportedTimeZone(value) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
        return true;
    }
    catch {
        return false;
    }
}
function shouldAttemptTelegramPolicy(policy, referenceDate = new Date()) {
    if (!policy.active) {
        return false;
    }
    const currentWindow = getPolicyWindowKey(referenceDate, policy.timezone);
    if (currentWindow.hour !== policy.deliveryHour) {
        return false;
    }
    if (policy.cadence === "weekdays" && (currentWindow.weekday === 0 || currentWindow.weekday === 6)) {
        return false;
    }
    if (!policy.lastAttemptAt) {
        return true;
    }
    const attemptedAt = policy.lastAttemptAt instanceof Date
        ? policy.lastAttemptAt
        : new Date(policy.lastAttemptAt);
    if (Number.isNaN(attemptedAt.getTime())) {
        return true;
    }
    const attemptedWindow = getPolicyWindowKey(attemptedAt, policy.timezone).windowKey;
    if (attemptedWindow !== currentWindow.windowKey) {
        return true;
    }
    if (policy.lastDeliveredAt) {
        const deliveredAt = policy.lastDeliveredAt instanceof Date
            ? policy.lastDeliveredAt
            : new Date(policy.lastDeliveredAt);
        if (!Number.isNaN(deliveredAt.getTime()) &&
            getPolicyWindowKey(deliveredAt, policy.timezone).windowKey === currentWindow.windowKey) {
            return false;
        }
    }
    return Boolean(policy.lastError);
}
async function executeTelegramPolicyRun(policies, deps = {}) {
    const now = deps.now ?? new Date();
    const deliver = deps.deliver ??
        (async (request) => {
            const result = await (0, telegram_delivery_1.deliverBriefToTelegram)(request);
            return {
                messageId: result.messageId,
            };
        });
    const results = [];
    let duePolicies = 0;
    let deliveredPolicies = 0;
    let failedPolicies = 0;
    let skippedPolicies = 0;
    for (const policy of policies) {
        if (!policy.active) {
            skippedPolicies += 1;
            results.push({
                policyId: policy.id,
                scope: policy.scope,
                projectId: policy.projectId,
                delivered: false,
                skipped: true,
                reason: "inactive",
            });
            continue;
        }
        try {
            if (!shouldAttemptTelegramPolicy(policy, now)) {
                skippedPolicies += 1;
                results.push({
                    policyId: policy.id,
                    scope: policy.scope,
                    projectId: policy.projectId,
                    delivered: false,
                    skipped: true,
                    reason: "not_due",
                });
                continue;
            }
            duePolicies += 1;
            const deliveryResult = await deliver({
                scope: policy.scope,
                projectId: policy.projectId ?? undefined,
                locale: policy.locale,
                chatId: policy.chatId,
                idempotencyKey: (0, delivery_ledger_1.buildScheduledBriefDeliveryIdempotencyKey)({
                    channel: "telegram",
                    policyId: policy.id,
                    windowKey: getPolicyWindowKey(now, policy.timezone).windowKey,
                }),
                scheduledPolicyId: policy.id,
            });
            deliveredPolicies += 1;
            results.push({
                policyId: policy.id,
                scope: policy.scope,
                projectId: policy.projectId,
                delivered: true,
                skipped: false,
                reason: "delivered",
                messageId: deliveryResult.messageId,
            });
            await deps.persistResult?.({
                policyId: policy.id,
                attemptedAt: now,
                deliveredAt: now,
                messageId: deliveryResult.messageId ?? null,
                error: null,
            });
        }
        catch (error) {
            failedPolicies += 1;
            results.push({
                policyId: policy.id,
                scope: policy.scope,
                projectId: policy.projectId,
                delivered: false,
                skipped: false,
                reason: "failed",
                error: error instanceof Error ? error.message : "Scheduled delivery failed.",
            });
            await deps.persistResult?.({
                policyId: policy.id,
                attemptedAt: now,
                deliveredAt: null,
                error: error instanceof Error ? error.message : "Scheduled delivery failed.",
            });
        }
    }
    return {
        checkedPolicies: policies.length,
        duePolicies,
        deliveredPolicies,
        failedPolicies,
        skippedPolicies,
        timestamp: now.toISOString(),
        results,
    };
}
async function listTelegramBriefDeliveryPolicies() {
    const policies = await prisma_1.prisma.telegramBriefDeliveryPolicy.findMany({
        include: policyInclude,
        orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    });
    return policies.map(serializeTelegramBriefDeliveryPolicy);
}
async function createTelegramBriefDeliveryPolicy(input) {
    const scope = input.scope;
    const projectId = scope === "project" ? normalizeOptionalString(input.projectId) : null;
    if (scope === "project" && !projectId) {
        throw new Error("projectId is required for project delivery policies.");
    }
    if (projectId) {
        await ensureProjectExists(projectId);
    }
    const created = await prisma_1.prisma.telegramBriefDeliveryPolicy.create({
        data: {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: input.workspaceId ?? "executive",
            scope,
            projectId,
            locale: (0, locale_1.resolveBriefLocale)(input.locale),
            chatId: normalizeOptionalString(input.chatId),
            cadence: input.cadence ?? "daily",
            timezone: input.timezone,
            deliveryHour: input.deliveryHour,
            active: input.active ?? true,
            createdByUserId: normalizeOptionalString(input.createdByUserId),
            updatedByUserId: normalizeOptionalString(input.createdByUserId),
            updatedAt: new Date(),
        },
        include: policyInclude,
    });
    return serializeTelegramBriefDeliveryPolicy(created);
}
async function updateTelegramBriefDeliveryPolicy(id, input) {
    const existing = await prisma_1.prisma.telegramBriefDeliveryPolicy.findUnique({
        where: { id },
        select: {
            id: true,
            scope: true,
            projectId: true,
        },
    });
    if (!existing) {
        throw new Error("Telegram brief delivery policy not found.");
    }
    const nextScope = input.scope ?? existing.scope;
    const nextProjectId = nextScope === "project"
        ? normalizeOptionalString(input.projectId) ??
            normalizeOptionalString(existing.projectId)
        : null;
    if (nextScope === "project" && !nextProjectId) {
        throw new Error("projectId is required for project delivery policies.");
    }
    if (nextProjectId) {
        await ensureProjectExists(nextProjectId);
    }
    const updated = await prisma_1.prisma.telegramBriefDeliveryPolicy.update({
        where: { id },
        data: {
            ...(input.scope !== undefined && { scope: input.scope }),
            ...(input.projectId !== undefined || nextScope === "portfolio"
                ? { projectId: nextProjectId }
                : {}),
            ...(input.locale !== undefined && { locale: (0, locale_1.resolveBriefLocale)(input.locale) }),
            ...(input.chatId !== undefined && { chatId: normalizeOptionalString(input.chatId) }),
            ...(input.cadence !== undefined && { cadence: input.cadence }),
            ...(input.timezone !== undefined && { timezone: input.timezone }),
            ...(input.deliveryHour !== undefined && { deliveryHour: input.deliveryHour }),
            ...(input.active !== undefined && { active: input.active }),
            ...(input.updatedByUserId !== undefined && {
                updatedByUserId: normalizeOptionalString(input.updatedByUserId),
            }),
            updatedAt: new Date(),
        },
        include: policyInclude,
    });
    return serializeTelegramBriefDeliveryPolicy(updated);
}
async function runDueTelegramBriefDeliveryPolicies() {
    const policies = await prisma_1.prisma.telegramBriefDeliveryPolicy.findMany({
        orderBy: [{ active: "desc" }, { updatedAt: "asc" }],
    });
    return executeTelegramPolicyRun(policies.map((policy) => ({
        id: policy.id,
        scope: policy.scope,
        projectId: policy.projectId,
        locale: (0, locale_1.resolveBriefLocale)(policy.locale),
        chatId: policy.chatId,
        cadence: policy.cadence,
        timezone: policy.timezone,
        deliveryHour: policy.deliveryHour,
        active: policy.active,
        lastAttemptAt: policy.lastAttemptAt,
        lastDeliveredAt: policy.lastDeliveredAt,
        lastError: policy.lastError,
    })), {
        persistResult: async (input) => {
            await prisma_1.prisma.telegramBriefDeliveryPolicy.update({
                where: { id: input.policyId },
                data: {
                    lastAttemptAt: input.attemptedAt,
                    ...(input.deliveredAt ? { lastDeliveredAt: input.deliveredAt } : {}),
                    ...(input.messageId !== undefined && input.messageId !== null
                        ? { lastMessageId: input.messageId }
                        : {}),
                    lastError: input.error ?? null,
                    updatedByUserId: "system:scheduled-digests",
                },
            });
        },
    });
}
function serializeTelegramBriefDeliveryPolicy(policy) {
    return {
        id: policy.id,
        workspaceId: policy.workspaceId,
        scope: policy.scope,
        projectId: policy.projectId,
        projectName: policy.project?.name ?? null,
        locale: (0, locale_1.resolveBriefLocale)(policy.locale),
        chatId: policy.chatId,
        cadence: policy.cadence,
        timezone: policy.timezone,
        deliveryHour: policy.deliveryHour,
        active: policy.active,
        createdByUserId: policy.createdByUserId,
        updatedByUserId: policy.updatedByUserId,
        lastAttemptAt: policy.lastAttemptAt?.toISOString() ?? null,
        lastDeliveredAt: policy.lastDeliveredAt?.toISOString() ?? null,
        lastMessageId: policy.lastMessageId,
        lastError: policy.lastError,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
    };
}
function getPolicyWindowKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        weekday: "short",
        hourCycle: "h23",
    }).formatToParts(date);
    const year = partValue(parts, "year");
    const month = partValue(parts, "month");
    const day = partValue(parts, "day");
    const hour = Number(partValue(parts, "hour"));
    const weekday = normalizeWeekday(partValue(parts, "weekday"));
    return {
        hour,
        weekday,
        windowKey: `${year}-${month}-${day}T${String(hour).padStart(2, "0")}`,
    };
}
function partValue(parts, type) {
    return parts.find((part) => part.type === type)?.value ?? "";
}
function normalizeWeekday(value) {
    switch (value) {
        case "Sun":
            return 0;
        case "Mon":
            return 1;
        case "Tue":
            return 2;
        case "Wed":
            return 3;
        case "Thu":
            return 4;
        case "Fri":
            return 5;
        case "Sat":
            return 6;
        default:
            return -1;
    }
}
async function ensureProjectExists(projectId) {
    const project = await prisma_1.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
    });
    if (!project) {
        throw new Error("Project not found for Telegram brief delivery policy.");
    }
}
function normalizeOptionalString(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
