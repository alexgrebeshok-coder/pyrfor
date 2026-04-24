var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma';
export class AgentCircuitOpenError extends Error {
    constructor(message, openUntil) {
        super(message);
        this.openUntil = openUntil;
        this.name = "AgentCircuitOpenError";
    }
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
function getCircuitSettings(runtimeConfig) {
    var _a, _b;
    const parsed = parseRuntimeConfig(runtimeConfig);
    return {
        failureThreshold: Math.max((_a = parsed.circuitFailureThreshold) !== null && _a !== void 0 ? _a : 3, 1),
        cooldownMs: Math.max(((_b = parsed.circuitCooldownSec) !== null && _b !== void 0 ? _b : 300) * 1000, 1000),
    };
}
function normalizeSnapshot(record) {
    var _a, _b, _c;
    return {
        state: (record === null || record === void 0 ? void 0 : record.circuitState) === "open" || (record === null || record === void 0 ? void 0 : record.circuitState) === "half-open"
            ? record.circuitState
            : "closed",
        consecutiveFailures: (_a = record === null || record === void 0 ? void 0 : record.consecutiveFailures) !== null && _a !== void 0 ? _a : 0,
        openedAt: (_b = record === null || record === void 0 ? void 0 : record.circuitOpenedAt) !== null && _b !== void 0 ? _b : null,
        openUntil: (_c = record === null || record === void 0 ? void 0 : record.circuitOpenUntil) !== null && _c !== void 0 ? _c : null,
    };
}
export function isAgentCircuitOpen(snapshot, now = new Date()) {
    return snapshot.state === "open" && !!snapshot.openUntil && snapshot.openUntil > now;
}
export function getAgentCircuitSnapshot(agentId_1) {
    return __awaiter(this, arguments, void 0, function* (agentId, prismaClient = prisma) {
        const runtimeState = yield prismaClient.agentRuntimeState.findUnique({
            where: { agentId },
            select: {
                consecutiveFailures: true,
                circuitState: true,
                circuitOpenedAt: true,
                circuitOpenUntil: true,
            },
        });
        return normalizeSnapshot(runtimeState);
    });
}
export function ensureAgentCircuitReady(agentId_1, runtimeConfig_1) {
    return __awaiter(this, arguments, void 0, function* (agentId, runtimeConfig, prismaClient = prisma) {
        var _a, _b;
        const snapshot = yield getAgentCircuitSnapshot(agentId, prismaClient);
        const now = new Date();
        if (isAgentCircuitOpen(snapshot, now)) {
            throw new AgentCircuitOpenError(`Circuit open for agent ${agentId} until ${(_b = (_a = snapshot.openUntil) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : "cooldown ends"}.`, snapshot.openUntil);
        }
        if (snapshot.state === "open" || snapshot.state === "half-open") {
            yield prismaClient.agentRuntimeState.upsert({
                where: { agentId },
                create: {
                    agentId,
                    consecutiveFailures: snapshot.consecutiveFailures,
                    circuitState: "half-open",
                    circuitOpenedAt: snapshot.openedAt,
                    circuitOpenUntil: null,
                },
                update: {
                    circuitState: "half-open",
                    circuitOpenUntil: null,
                },
            });
            return Object.assign(Object.assign({}, snapshot), { state: "half-open", openUntil: null });
        }
        return snapshot;
    });
}
export function recordAgentCircuitSuccess(agentId_1) {
    return __awaiter(this, arguments, void 0, function* (agentId, prismaClient = prisma) {
        yield prismaClient.agentRuntimeState.upsert({
            where: { agentId },
            create: {
                agentId,
                consecutiveFailures: 0,
                circuitState: "closed",
                circuitOpenedAt: null,
                circuitOpenUntil: null,
            },
            update: {
                consecutiveFailures: 0,
                circuitState: "closed",
                circuitOpenedAt: null,
                circuitOpenUntil: null,
            },
        });
    });
}
export function recordAgentCircuitFailure(agentId_1, runtimeConfig_1) {
    return __awaiter(this, arguments, void 0, function* (agentId, runtimeConfig, prismaClient = prisma) {
        const current = yield getAgentCircuitSnapshot(agentId, prismaClient);
        const settings = getCircuitSettings(runtimeConfig);
        const nextFailures = current.consecutiveFailures + 1;
        const now = new Date();
        const shouldOpen = current.state === "half-open" || nextFailures >= settings.failureThreshold;
        const openUntil = shouldOpen ? new Date(now.getTime() + settings.cooldownMs) : null;
        const nextState = shouldOpen ? "open" : "closed";
        yield prismaClient.agentRuntimeState.upsert({
            where: { agentId },
            create: {
                agentId,
                consecutiveFailures: nextFailures,
                circuitState: nextState,
                circuitOpenedAt: shouldOpen ? now : null,
                circuitOpenUntil: openUntil,
            },
            update: {
                consecutiveFailures: nextFailures,
                circuitState: nextState,
                circuitOpenedAt: shouldOpen ? now : null,
                circuitOpenUntil: openUntil,
            },
        });
        return {
            state: nextState,
            consecutiveFailures: nextFailures,
            openedAt: shouldOpen ? now : null,
            openUntil,
        };
    });
}
