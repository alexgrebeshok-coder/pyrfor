var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "node:crypto";
import { prisma } from '../prisma';
import { buildScheduledBriefDeliveryIdempotencyKey } from "./delivery-ledger";
import { deliverBriefToTelegram } from "./telegram-delivery";
import { resolveBriefLocale } from "./locale";
const policyInclude = {
    project: {
        select: {
            id: true,
            name: true,
        },
    },
};
export function isSupportedTimeZone(value) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
        return true;
    }
    catch (_a) {
        return false;
    }
}
export function shouldAttemptTelegramPolicy(policy, referenceDate = new Date()) {
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
export function executeTelegramPolicyRun(policies_1) {
    return __awaiter(this, arguments, void 0, function* (policies, deps = {}) {
        var _a, _b, _c, _d, _e, _f;
        const now = (_a = deps.now) !== null && _a !== void 0 ? _a : new Date();
        const deliver = (_b = deps.deliver) !== null && _b !== void 0 ? _b : ((request) => __awaiter(this, void 0, void 0, function* () {
            const result = yield deliverBriefToTelegram(request);
            return {
                messageId: result.messageId,
            };
        }));
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
                const deliveryResult = yield deliver({
                    scope: policy.scope,
                    projectId: (_c = policy.projectId) !== null && _c !== void 0 ? _c : undefined,
                    locale: policy.locale,
                    chatId: policy.chatId,
                    idempotencyKey: buildScheduledBriefDeliveryIdempotencyKey({
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
                yield ((_d = deps.persistResult) === null || _d === void 0 ? void 0 : _d.call(deps, {
                    policyId: policy.id,
                    attemptedAt: now,
                    deliveredAt: now,
                    messageId: (_e = deliveryResult.messageId) !== null && _e !== void 0 ? _e : null,
                    error: null,
                }));
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
                yield ((_f = deps.persistResult) === null || _f === void 0 ? void 0 : _f.call(deps, {
                    policyId: policy.id,
                    attemptedAt: now,
                    deliveredAt: null,
                    error: error instanceof Error ? error.message : "Scheduled delivery failed.",
                }));
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
    });
}
export function listTelegramBriefDeliveryPolicies() {
    return __awaiter(this, void 0, void 0, function* () {
        const policies = yield prisma.telegramBriefDeliveryPolicy.findMany({
            include: policyInclude,
            orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
        });
        return policies.map(serializeTelegramBriefDeliveryPolicy);
    });
}
export function createTelegramBriefDeliveryPolicy(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const scope = input.scope;
        const projectId = scope === "project" ? normalizeOptionalString(input.projectId) : null;
        if (scope === "project" && !projectId) {
            throw new Error("projectId is required for project delivery policies.");
        }
        if (projectId) {
            yield ensureProjectExists(projectId);
        }
        const created = yield prisma.telegramBriefDeliveryPolicy.create({
            data: {
                id: randomUUID(),
                workspaceId: (_a = input.workspaceId) !== null && _a !== void 0 ? _a : "executive",
                scope,
                projectId,
                locale: resolveBriefLocale(input.locale),
                chatId: normalizeOptionalString(input.chatId),
                cadence: (_b = input.cadence) !== null && _b !== void 0 ? _b : "daily",
                timezone: input.timezone,
                deliveryHour: input.deliveryHour,
                active: (_c = input.active) !== null && _c !== void 0 ? _c : true,
                createdByUserId: normalizeOptionalString(input.createdByUserId),
                updatedByUserId: normalizeOptionalString(input.createdByUserId),
                updatedAt: new Date(),
            },
            include: policyInclude,
        });
        return serializeTelegramBriefDeliveryPolicy(created);
    });
}
export function updateTelegramBriefDeliveryPolicy(id, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const existing = yield prisma.telegramBriefDeliveryPolicy.findUnique({
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
        const nextScope = (_a = input.scope) !== null && _a !== void 0 ? _a : existing.scope;
        const nextProjectId = nextScope === "project"
            ? (_b = normalizeOptionalString(input.projectId)) !== null && _b !== void 0 ? _b : normalizeOptionalString(existing.projectId)
            : null;
        if (nextScope === "project" && !nextProjectId) {
            throw new Error("projectId is required for project delivery policies.");
        }
        if (nextProjectId) {
            yield ensureProjectExists(nextProjectId);
        }
        const updated = yield prisma.telegramBriefDeliveryPolicy.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (input.scope !== undefined && { scope: input.scope })), (input.projectId !== undefined || nextScope === "portfolio"
                ? { projectId: nextProjectId }
                : {})), (input.locale !== undefined && { locale: resolveBriefLocale(input.locale) })), (input.chatId !== undefined && { chatId: normalizeOptionalString(input.chatId) })), (input.cadence !== undefined && { cadence: input.cadence })), (input.timezone !== undefined && { timezone: input.timezone })), (input.deliveryHour !== undefined && { deliveryHour: input.deliveryHour })), (input.active !== undefined && { active: input.active })), (input.updatedByUserId !== undefined && {
                updatedByUserId: normalizeOptionalString(input.updatedByUserId),
            })), { updatedAt: new Date() }),
            include: policyInclude,
        });
        return serializeTelegramBriefDeliveryPolicy(updated);
    });
}
export function runDueTelegramBriefDeliveryPolicies() {
    return __awaiter(this, void 0, void 0, function* () {
        const policies = yield prisma.telegramBriefDeliveryPolicy.findMany({
            orderBy: [{ active: "desc" }, { updatedAt: "asc" }],
        });
        return executeTelegramPolicyRun(policies.map((policy) => ({
            id: policy.id,
            scope: policy.scope,
            projectId: policy.projectId,
            locale: resolveBriefLocale(policy.locale),
            chatId: policy.chatId,
            cadence: policy.cadence,
            timezone: policy.timezone,
            deliveryHour: policy.deliveryHour,
            active: policy.active,
            lastAttemptAt: policy.lastAttemptAt,
            lastDeliveredAt: policy.lastDeliveredAt,
            lastError: policy.lastError,
        })), {
            persistResult: (input) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                yield prisma.telegramBriefDeliveryPolicy.update({
                    where: { id: input.policyId },
                    data: Object.assign(Object.assign(Object.assign({ lastAttemptAt: input.attemptedAt }, (input.deliveredAt ? { lastDeliveredAt: input.deliveredAt } : {})), (input.messageId !== undefined && input.messageId !== null
                        ? { lastMessageId: input.messageId }
                        : {})), { lastError: (_a = input.error) !== null && _a !== void 0 ? _a : null, updatedByUserId: "system:scheduled-digests" }),
                });
            }),
        });
    });
}
function serializeTelegramBriefDeliveryPolicy(policy) {
    var _a, _b, _c, _d, _e, _f;
    return {
        id: policy.id,
        workspaceId: policy.workspaceId,
        scope: policy.scope,
        projectId: policy.projectId,
        projectName: (_b = (_a = policy.project) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
        locale: resolveBriefLocale(policy.locale),
        chatId: policy.chatId,
        cadence: policy.cadence,
        timezone: policy.timezone,
        deliveryHour: policy.deliveryHour,
        active: policy.active,
        createdByUserId: policy.createdByUserId,
        updatedByUserId: policy.updatedByUserId,
        lastAttemptAt: (_d = (_c = policy.lastAttemptAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : null,
        lastDeliveredAt: (_f = (_e = policy.lastDeliveredAt) === null || _e === void 0 ? void 0 : _e.toISOString()) !== null && _f !== void 0 ? _f : null,
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
    var _a, _b;
    return (_b = (_a = parts.find((part) => part.type === type)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : "";
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
function ensureProjectExists(projectId) {
    return __awaiter(this, void 0, void 0, function* () {
        const project = yield prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true },
        });
        if (!project) {
            throw new Error("Project not found for Telegram brief delivery policy.");
        }
    });
}
function normalizeOptionalString(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
