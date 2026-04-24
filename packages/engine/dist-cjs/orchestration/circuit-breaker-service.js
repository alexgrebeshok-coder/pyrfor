"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCircuitOpenError = void 0;
exports.isAgentCircuitOpen = isAgentCircuitOpen;
exports.getAgentCircuitSnapshot = getAgentCircuitSnapshot;
exports.ensureAgentCircuitReady = ensureAgentCircuitReady;
exports.recordAgentCircuitSuccess = recordAgentCircuitSuccess;
exports.recordAgentCircuitFailure = recordAgentCircuitFailure;
const prisma_1 = require("../prisma");
class AgentCircuitOpenError extends Error {
    constructor(message, openUntil) {
        super(message);
        this.openUntil = openUntil;
        this.name = "AgentCircuitOpenError";
    }
}
exports.AgentCircuitOpenError = AgentCircuitOpenError;
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
function getCircuitSettings(runtimeConfig) {
    const parsed = parseRuntimeConfig(runtimeConfig);
    return {
        failureThreshold: Math.max(parsed.circuitFailureThreshold ?? 3, 1),
        cooldownMs: Math.max((parsed.circuitCooldownSec ?? 300) * 1000, 1000),
    };
}
function normalizeSnapshot(record) {
    return {
        state: record?.circuitState === "open" || record?.circuitState === "half-open"
            ? record.circuitState
            : "closed",
        consecutiveFailures: record?.consecutiveFailures ?? 0,
        openedAt: record?.circuitOpenedAt ?? null,
        openUntil: record?.circuitOpenUntil ?? null,
    };
}
function isAgentCircuitOpen(snapshot, now = new Date()) {
    return snapshot.state === "open" && !!snapshot.openUntil && snapshot.openUntil > now;
}
async function getAgentCircuitSnapshot(agentId, prismaClient = prisma_1.prisma) {
    const runtimeState = await prismaClient.agentRuntimeState.findUnique({
        where: { agentId },
        select: {
            consecutiveFailures: true,
            circuitState: true,
            circuitOpenedAt: true,
            circuitOpenUntil: true,
        },
    });
    return normalizeSnapshot(runtimeState);
}
async function ensureAgentCircuitReady(agentId, runtimeConfig, prismaClient = prisma_1.prisma) {
    const snapshot = await getAgentCircuitSnapshot(agentId, prismaClient);
    const now = new Date();
    if (isAgentCircuitOpen(snapshot, now)) {
        throw new AgentCircuitOpenError(`Circuit open for agent ${agentId} until ${snapshot.openUntil?.toISOString() ?? "cooldown ends"}.`, snapshot.openUntil);
    }
    if (snapshot.state === "open" || snapshot.state === "half-open") {
        await prismaClient.agentRuntimeState.upsert({
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
        return {
            ...snapshot,
            state: "half-open",
            openUntil: null,
        };
    }
    return snapshot;
}
async function recordAgentCircuitSuccess(agentId, prismaClient = prisma_1.prisma) {
    await prismaClient.agentRuntimeState.upsert({
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
}
async function recordAgentCircuitFailure(agentId, runtimeConfig, prismaClient = prisma_1.prisma) {
    const current = await getAgentCircuitSnapshot(agentId, prismaClient);
    const settings = getCircuitSettings(runtimeConfig);
    const nextFailures = current.consecutiveFailures + 1;
    const now = new Date();
    const shouldOpen = current.state === "half-open" || nextFailures >= settings.failureThreshold;
    const openUntil = shouldOpen ? new Date(now.getTime() + settings.cooldownMs) : null;
    const nextState = shouldOpen ? "open" : "closed";
    await prismaClient.agentRuntimeState.upsert({
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
}
