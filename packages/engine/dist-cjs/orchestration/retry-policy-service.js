"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWakeupIdempotencyKey = buildWakeupIdempotencyKey;
exports.resolveMaxRetries = resolveMaxRetries;
exports.computeRetryDelayMs = computeRetryDelayMs;
exports.classifyOrchestrationFailure = classifyOrchestrationFailure;
exports.applyWakeupFailure = applyWakeupFailure;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../prisma");
const error_utils_1 = require("./error-utils");
const BASE_RETRY_DELAY_MS = 15000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
function stableValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stableValue(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, stableValue(entry)]));
    }
    return value;
}
function buildWakeupIdempotencyKey(input) {
    const now = input.now ?? new Date();
    const bucketMs = Math.max(input.bucketMs ?? 60000, 1);
    const bucket = Math.floor(now.getTime() / bucketMs);
    const hash = (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify({
        scope: input.scope ?? input.reason,
        reason: input.reason,
        triggerData: stableValue(input.triggerData ?? {}),
    }))
        .digest("hex")
        .slice(0, 16);
    return `${input.scope ?? input.reason}:${input.agentId}:${bucket}:${hash}`;
}
function parseRuntimeConfig(runtimeConfig) {
    if (!runtimeConfig) {
        return {};
    }
    if (typeof runtimeConfig === "string") {
        try {
            const parsed = JSON.parse(runtimeConfig);
            return parsed && typeof parsed === "object"
                ? parsed
                : {};
        }
        catch {
            return {};
        }
    }
    return runtimeConfig;
}
function resolveMaxRetries(runtimeConfig, fallback = 3) {
    const parsed = parseRuntimeConfig(runtimeConfig);
    return Math.max(parsed.maxRetries ?? fallback, 0);
}
function computeRetryDelayMs(retryCount, runtimeConfig) {
    const parsed = parseRuntimeConfig(runtimeConfig);
    const baseDelayMs = Math.max((parsed.retryBackoffBaseSec ?? BASE_RETRY_DELAY_MS / 1000) * 1000, 1000);
    return Math.min(baseDelayMs * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
}
function classifyOrchestrationFailure(error) {
    const message = (0, error_utils_1.getErrorMessage)(error, "Unexpected orchestration failure");
    if (/budget exceeded|monthly budget exceeded/i.test(message)) {
        return { errorType: "budget_exceeded", message, retryable: false };
    }
    if (/permission denied|forbidden|cannot access/i.test(message)) {
        return { errorType: "permission_denied", message, retryable: false };
    }
    if (/invalid|required|not found|paused|terminated/i.test(message)) {
        return { errorType: "validation", message, retryable: false };
    }
    if (/circuit breaker is open|circuit open/i.test(message)) {
        return { errorType: "circuit_open", message, retryable: true };
    }
    if (/timeout|timed out|abort/i.test(message)) {
        return { errorType: "timeout", message, retryable: true };
    }
    if (/rate limit|429|too many requests/i.test(message)) {
        return { errorType: "rate_limit", message, retryable: true };
    }
    if (/network|fetch failed|econn|socket|dns|gateway/i.test(message)) {
        return { errorType: "network", message, retryable: true };
    }
    if (/adapter|provider unavailable|service unavailable/i.test(message)) {
        return { errorType: "adapter_unavailable", message, retryable: true };
    }
    if (/cancelled|canceled/i.test(message)) {
        return { errorType: "cancelled", message, retryable: false };
    }
    if (/failed|error/i.test(message)) {
        return { errorType: "execution_failed", message, retryable: true };
    }
    return { errorType: "unknown", message, retryable: true };
}
async function applyWakeupFailure(input) {
    const prismaClient = input.prismaClient ?? prisma_1.prisma;
    const classification = classifyOrchestrationFailure(input.error);
    const maxRetries = input.wakeupRequest.maxRetries > 0
        ? input.wakeupRequest.maxRetries
        : resolveMaxRetries(input.runtimeConfig);
    const retryCount = input.wakeupRequest.retryCount;
    if (classification.retryable && retryCount < maxRetries) {
        const delayMs = computeRetryDelayMs(retryCount, input.runtimeConfig);
        const nextRetryAt = new Date(Date.now() + delayMs);
        await prismaClient.agentWakeupRequest.update({
            where: { id: input.wakeupRequest.id },
            data: {
                status: "queued",
                retryCount: retryCount + 1,
                availableAt: nextRetryAt,
                lastError: classification.message,
                lastErrorType: classification.errorType,
                processedAt: null,
            },
        });
        return {
            kind: "requeue",
            classification,
            retryCount: retryCount + 1,
            maxRetries,
            nextRetryAt,
        };
    }
    await prismaClient.deadLetterJob.create({
        data: {
            workspaceId: input.workspaceId,
            agentId: input.wakeupRequest.agentId,
            wakeupRequestId: input.wakeupRequest.id,
            runId: input.runId,
            reason: input.wakeupRequest.reason,
            errorType: classification.errorType,
            errorMessage: classification.message,
            payloadJson: input.wakeupRequest.triggerData,
            attempts: retryCount,
            status: "open",
        },
    });
    await prismaClient.agentWakeupRequest.update({
        where: { id: input.wakeupRequest.id },
        data: {
            status: "failed",
            lastError: classification.message,
            lastErrorType: classification.errorType,
            processedAt: new Date(),
        },
    });
    return {
        kind: "dead_letter",
        classification,
        retryCount,
        maxRetries,
    };
}
