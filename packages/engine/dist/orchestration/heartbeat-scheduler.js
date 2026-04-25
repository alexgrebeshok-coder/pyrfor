var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { buildWakeupIdempotencyKey, applyWakeupFailure, resolveMaxRetries, } from "./retry-policy-service.js";
import { isAgentCircuitOpen, } from "./circuit-breaker-service.js";
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
function parseTriggerData(raw) {
    try {
        const parsed = JSON.parse(raw || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch (_a) {
        return {};
    }
}
function getAgentCircuit(agent) {
    var _a, _b, _c, _d;
    const circuitState = ((_a = agent.runtimeState) === null || _a === void 0 ? void 0 : _a.circuitState) === "open" ||
        ((_b = agent.runtimeState) === null || _b === void 0 ? void 0 : _b.circuitState) === "half-open"
        ? agent.runtimeState.circuitState
        : "closed";
    return {
        state: circuitState,
        consecutiveFailures: 0,
        openedAt: null,
        openUntil: (_d = (_c = agent.runtimeState) === null || _c === void 0 ? void 0 : _c.circuitOpenUntil) !== null && _d !== void 0 ? _d : null,
    };
}
export function processHeartbeatQueue(deps_1) {
    return __awaiter(this, arguments, void 0, function* (deps, config = {}) {
        var _a, _b, _c, _d, _e, _f;
        const prisma = deps.prisma;
        const fetchImpl = (_a = deps.fetchImpl) !== null && _a !== void 0 ? _a : fetch;
        const logger = (_b = deps.logger) !== null && _b !== void 0 ? _b : noopLogger;
        const now = (_c = deps.now) !== null && _c !== void 0 ? _c : new Date();
        const batchSize = (_d = config.batchSize) !== null && _d !== void 0 ? _d : 5;
        const gatewayPort = (_e = config.gatewayPort) !== null && _e !== void 0 ? _e : 3000;
        const requestTimeoutMs = (_f = config.requestTimeoutMs) !== null && _f !== void 0 ? _f : 120000;
        const queued = yield prisma.agentWakeupRequest.findMany({
            where: {
                status: "queued",
                availableAt: { lte: now },
            },
            include: {
                agent: {
                    select: {
                        workspaceId: true,
                        status: true,
                        runtimeState: {
                            select: {
                                circuitState: true,
                                circuitOpenUntil: true,
                            },
                        },
                    },
                },
            },
            orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
            take: batchSize,
        });
        let processed = 0;
        let failed = 0;
        let skipped = 0;
        for (const req of queued) {
            if (req.agent.status === "paused" || req.agent.status === "terminated") {
                yield prisma.agentWakeupRequest.update({
                    where: { id: req.id },
                    data: { status: "skipped", processedAt: new Date() },
                });
                skipped++;
                continue;
            }
            const circuit = getAgentCircuit(req.agent);
            if (isAgentCircuitOpen(circuit, now) && circuit.openUntil) {
                yield prisma.agentWakeupRequest.update({
                    where: { id: req.id },
                    data: {
                        availableAt: circuit.openUntil,
                        lastError: `Circuit open until ${circuit.openUntil.toISOString()}`,
                        lastErrorType: "circuit_open",
                    },
                });
                skipped++;
                continue;
            }
            yield prisma.agentWakeupRequest.update({
                where: { id: req.id },
                data: { status: "processing" },
            });
            const triggerData = parseTriggerData(req.triggerData);
            try {
                let runId = typeof triggerData.runId === "string" && triggerData.runId.trim()
                    ? triggerData.runId
                    : undefined;
                if (!runId) {
                    const run = yield prisma.heartbeatRun.create({
                        data: {
                            workspaceId: req.agent.workspaceId,
                            agentId: req.agentId,
                            wakeupRequestId: req.id,
                            status: "queued",
                            invocationSource: req.reason,
                            contextSnapshot: req.triggerData,
                        },
                    });
                    runId = run.id;
                    triggerData.runId = run.id;
                    yield prisma.agentWakeupRequest.update({
                        where: { id: req.id },
                        data: { triggerData: JSON.stringify(triggerData) },
                    });
                }
                let response = null;
                let transportError = null;
                try {
                    response = yield fetchImpl(`http://localhost:${gatewayPort}/api/orchestration/heartbeat/execute`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            runId,
                            agentId: req.agentId,
                            workspaceId: req.agent.workspaceId,
                            wakeupRequestId: req.id,
                            task: typeof triggerData.task === "string" ? triggerData.task : undefined,
                        }),
                        signal: AbortSignal.timeout(requestTimeoutMs),
                    });
                }
                catch (error) {
                    transportError = error;
                    logger.warn(`Agent heartbeat HTTP failed for ${req.agentId}`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                if (response === null || response === void 0 ? void 0 : response.ok) {
                    processed++;
                    continue;
                }
                failed++;
                const decision = yield applyWakeupFailure({
                    wakeupRequest: req,
                    workspaceId: req.agent.workspaceId,
                    runId,
                    error: transportError !== null && transportError !== void 0 ? transportError : new Error(response
                        ? `Daemon HTTP trigger failed with status ${response.status}`
                        : "Daemon HTTP trigger failed"),
                    prismaClient: prisma,
                });
                yield prisma.agent.update({
                    where: { id: req.agentId },
                    data: { status: "error" },
                });
                if (decision.kind === "dead_letter") {
                    yield prisma.heartbeatRun.update({
                        where: { id: runId },
                        data: {
                            status: "failed",
                            finishedAt: new Date(),
                            resultJson: JSON.stringify({
                                error: decision.classification.message,
                                errorType: decision.classification.errorType,
                            }),
                        },
                    });
                }
            }
            catch (error) {
                failed++;
                logger.error(`Agent heartbeat failed for ${req.agentId}`, {
                    error: error instanceof Error ? error.message : String(error),
                });
                try {
                    yield applyWakeupFailure({
                        wakeupRequest: req,
                        workspaceId: req.agent.workspaceId,
                        error,
                        prismaClient: prisma,
                    });
                }
                catch (_g) {
                    // Keep the original failure as the primary signal; cleanup best-effort only.
                }
            }
        }
        return {
            queued: queued.length,
            processed,
            failed,
            skipped,
        };
    });
}
export function enqueueScheduledHeartbeatWakeups(deps_1) {
    return __awaiter(this, arguments, void 0, function* (deps, config = {}) {
        var _a, _b, _c;
        const prisma = deps.prisma;
        const logger = (_a = deps.logger) !== null && _a !== void 0 ? _a : noopLogger;
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : new Date();
        const duplicateWindowMs = (_c = config.duplicateWindowMs) !== null && _c !== void 0 ? _c : 5 * 60 * 1000;
        const scheduledAgents = yield prisma.agent.findMany({
            where: {
                status: { in: ["idle"] },
                runtimeConfig: { not: "{}" },
            },
            select: {
                id: true,
                workspaceId: true,
                runtimeConfig: true,
                slug: true,
                runtimeState: {
                    select: {
                        circuitState: true,
                        circuitOpenUntil: true,
                    },
                },
            },
        });
        let enqueued = 0;
        for (const agent of scheduledAgents) {
            try {
                const parsedConfig = parseTriggerData(agent.runtimeConfig);
                const schedule = typeof parsedConfig.schedule === "string" ? parsedConfig.schedule : undefined;
                if (!schedule || !cronMatchesNow(schedule, now))
                    continue;
                if (isAgentCircuitOpen(getAgentCircuit(agent), now)) {
                    continue;
                }
                const idempotencyKey = buildWakeupIdempotencyKey({
                    agentId: agent.id,
                    reason: "cron",
                    triggerData: { schedule },
                    scope: "scheduled",
                    now,
                    bucketMs: duplicateWindowMs,
                });
                const recent = yield prisma.agentWakeupRequest.findFirst({
                    where: {
                        agentId: agent.id,
                        idempotencyKey,
                        status: { in: ["queued", "processing", "processed"] },
                        createdAt: { gte: new Date(now.getTime() - duplicateWindowMs) },
                    },
                });
                if (recent)
                    continue;
                yield prisma.agentWakeupRequest.create({
                    data: {
                        agentId: agent.id,
                        reason: "cron",
                        triggerData: JSON.stringify({ schedule }),
                        status: "queued",
                        idempotencyKey,
                        maxRetries: resolveMaxRetries(agent.runtimeConfig),
                    },
                });
                enqueued++;
                logger.info(`Scheduled wakeup for ${agent.slug} (${schedule})`);
            }
            catch (error) {
                logger.warn(`Failed to check schedule for agent ${agent.id}`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return {
            checked: scheduledAgents.length,
            enqueued,
        };
    });
}
export function runHeartbeatScheduler(deps_1) {
    return __awaiter(this, arguments, void 0, function* (deps, config = {}) {
        var _a;
        const logger = (_a = deps.logger) !== null && _a !== void 0 ? _a : noopLogger;
        const queue = yield processHeartbeatQueue(deps, config);
        const schedule = yield enqueueScheduledHeartbeatWakeups(deps, config);
        if (queue.queued > 0 || schedule.enqueued > 0) {
            logger.info("Agent heartbeat cycle completed", {
                queued: queue.queued,
                processed: queue.processed,
                failed: queue.failed,
                skipped: queue.skipped,
                scheduledChecked: schedule.checked,
                scheduledEnqueued: schedule.enqueued,
            });
        }
        return Object.assign(Object.assign({}, queue), schedule);
    });
}
export function cronMatchesNow(expression, now = new Date()) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5)
        return false;
    const fields = [
        now.getMinutes(),
        now.getHours(),
        now.getDate(),
        now.getMonth() + 1,
        now.getDay(),
    ];
    const ranges = [
        [0, 59],
        [0, 23],
        [1, 31],
        [1, 12],
        [0, 7],
    ];
    for (let index = 0; index < 5; index++) {
        if (!fieldMatches(parts[index], fields[index], ranges[index])) {
            return false;
        }
    }
    return true;
}
function fieldMatches(pattern, value, [min, max]) {
    if (pattern === "*")
        return true;
    for (const part of pattern.split(",")) {
        const [rangeStr, stepStr] = part.split("/");
        const step = stepStr ? Number.parseInt(stepStr, 10) : 1;
        if (!Number.isFinite(step) || step <= 0)
            continue;
        if (rangeStr === "*") {
            if ((value - min) % step === 0)
                return true;
            continue;
        }
        if (rangeStr.includes("-")) {
            const [rawLo, rawHi] = rangeStr.split("-");
            const lo = Number.parseInt(rawLo, 10);
            const hi = Number.parseInt(rawHi, 10);
            if (!Number.isFinite(lo) || !Number.isFinite(hi))
                continue;
            if (lo < min || hi > max)
                continue;
            if (value >= lo && value <= hi && (value - lo) % step === 0)
                return true;
            continue;
        }
        const exact = Number.parseInt(rangeStr, 10);
        if (Number.isFinite(exact) && exact >= min && exact <= max && exact === value) {
            return true;
        }
    }
    return false;
}
