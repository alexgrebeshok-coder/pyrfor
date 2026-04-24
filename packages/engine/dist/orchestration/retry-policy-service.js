var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from "node:crypto";
import { prisma } from '../prisma';
import { getErrorMessage } from "./error-utils";
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
export function buildWakeupIdempotencyKey(input) {
    var _a, _b, _c, _d, _e;
    const now = (_a = input.now) !== null && _a !== void 0 ? _a : new Date();
    const bucketMs = Math.max((_b = input.bucketMs) !== null && _b !== void 0 ? _b : 60000, 1);
    const bucket = Math.floor(now.getTime() / bucketMs);
    const hash = createHash("sha256")
        .update(JSON.stringify({
        scope: (_c = input.scope) !== null && _c !== void 0 ? _c : input.reason,
        reason: input.reason,
        triggerData: stableValue((_d = input.triggerData) !== null && _d !== void 0 ? _d : {}),
    }))
        .digest("hex")
        .slice(0, 16);
    return `${(_e = input.scope) !== null && _e !== void 0 ? _e : input.reason}:${input.agentId}:${bucket}:${hash}`;
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
        catch (_a) {
            return {};
        }
    }
    return runtimeConfig;
}
export function resolveMaxRetries(runtimeConfig, fallback = 3) {
    var _a;
    const parsed = parseRuntimeConfig(runtimeConfig);
    return Math.max((_a = parsed.maxRetries) !== null && _a !== void 0 ? _a : fallback, 0);
}
export function computeRetryDelayMs(retryCount, runtimeConfig) {
    var _a;
    const parsed = parseRuntimeConfig(runtimeConfig);
    const baseDelayMs = Math.max(((_a = parsed.retryBackoffBaseSec) !== null && _a !== void 0 ? _a : BASE_RETRY_DELAY_MS / 1000) * 1000, 1000);
    return Math.min(baseDelayMs * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
}
export function classifyOrchestrationFailure(error) {
    const message = getErrorMessage(error, "Unexpected orchestration failure");
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
export function applyWakeupFailure(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const prismaClient = (_a = input.prismaClient) !== null && _a !== void 0 ? _a : prisma;
        const classification = classifyOrchestrationFailure(input.error);
        const maxRetries = input.wakeupRequest.maxRetries > 0
            ? input.wakeupRequest.maxRetries
            : resolveMaxRetries(input.runtimeConfig);
        const retryCount = input.wakeupRequest.retryCount;
        if (classification.retryable && retryCount < maxRetries) {
            const delayMs = computeRetryDelayMs(retryCount, input.runtimeConfig);
            const nextRetryAt = new Date(Date.now() + delayMs);
            yield prismaClient.agentWakeupRequest.update({
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
        yield prismaClient.deadLetterJob.create({
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
        yield prismaClient.agentWakeupRequest.update({
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
    });
}
