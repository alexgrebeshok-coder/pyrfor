"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processHeartbeatQueue = processHeartbeatQueue;
exports.enqueueScheduledHeartbeatWakeups = enqueueScheduledHeartbeatWakeups;
exports.runHeartbeatScheduler = runHeartbeatScheduler;
exports.cronMatchesNow = cronMatchesNow;
const retry_policy_service_1 = require("./retry-policy-service");
const circuit_breaker_service_1 = require("./circuit-breaker-service");
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
    catch {
        return {};
    }
}
function getAgentCircuit(agent) {
    const circuitState = agent.runtimeState?.circuitState === "open" ||
        agent.runtimeState?.circuitState === "half-open"
        ? agent.runtimeState.circuitState
        : "closed";
    return {
        state: circuitState,
        consecutiveFailures: 0,
        openedAt: null,
        openUntil: agent.runtimeState?.circuitOpenUntil ?? null,
    };
}
async function processHeartbeatQueue(deps, config = {}) {
    const prisma = deps.prisma;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const logger = deps.logger ?? noopLogger;
    const now = deps.now ?? new Date();
    const batchSize = config.batchSize ?? 5;
    const gatewayPort = config.gatewayPort ?? 3000;
    const requestTimeoutMs = config.requestTimeoutMs ?? 120000;
    const queued = await prisma.agentWakeupRequest.findMany({
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
            await prisma.agentWakeupRequest.update({
                where: { id: req.id },
                data: { status: "skipped", processedAt: new Date() },
            });
            skipped++;
            continue;
        }
        const circuit = getAgentCircuit(req.agent);
        if ((0, circuit_breaker_service_1.isAgentCircuitOpen)(circuit, now) && circuit.openUntil) {
            await prisma.agentWakeupRequest.update({
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
        await prisma.agentWakeupRequest.update({
            where: { id: req.id },
            data: { status: "processing" },
        });
        const triggerData = parseTriggerData(req.triggerData);
        try {
            let runId = typeof triggerData.runId === "string" && triggerData.runId.trim()
                ? triggerData.runId
                : undefined;
            if (!runId) {
                const run = await prisma.heartbeatRun.create({
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
                await prisma.agentWakeupRequest.update({
                    where: { id: req.id },
                    data: { triggerData: JSON.stringify(triggerData) },
                });
            }
            let response = null;
            let transportError = null;
            try {
                response = await fetchImpl(`http://localhost:${gatewayPort}/api/orchestration/heartbeat/execute`, {
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
            if (response?.ok) {
                processed++;
                continue;
            }
            failed++;
            const decision = await (0, retry_policy_service_1.applyWakeupFailure)({
                wakeupRequest: req,
                workspaceId: req.agent.workspaceId,
                runId,
                error: transportError ??
                    new Error(response
                        ? `Daemon HTTP trigger failed with status ${response.status}`
                        : "Daemon HTTP trigger failed"),
                prismaClient: prisma,
            });
            await prisma.agent.update({
                where: { id: req.agentId },
                data: { status: "error" },
            });
            if (decision.kind === "dead_letter") {
                await prisma.heartbeatRun.update({
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
                await (0, retry_policy_service_1.applyWakeupFailure)({
                    wakeupRequest: req,
                    workspaceId: req.agent.workspaceId,
                    error,
                    prismaClient: prisma,
                });
            }
            catch {
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
}
async function enqueueScheduledHeartbeatWakeups(deps, config = {}) {
    const prisma = deps.prisma;
    const logger = deps.logger ?? noopLogger;
    const now = deps.now ?? new Date();
    const duplicateWindowMs = config.duplicateWindowMs ?? 5 * 60 * 1000;
    const scheduledAgents = await prisma.agent.findMany({
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
            if ((0, circuit_breaker_service_1.isAgentCircuitOpen)(getAgentCircuit(agent), now)) {
                continue;
            }
            const idempotencyKey = (0, retry_policy_service_1.buildWakeupIdempotencyKey)({
                agentId: agent.id,
                reason: "cron",
                triggerData: { schedule },
                scope: "scheduled",
                now,
                bucketMs: duplicateWindowMs,
            });
            const recent = await prisma.agentWakeupRequest.findFirst({
                where: {
                    agentId: agent.id,
                    idempotencyKey,
                    status: { in: ["queued", "processing", "processed"] },
                    createdAt: { gte: new Date(now.getTime() - duplicateWindowMs) },
                },
            });
            if (recent)
                continue;
            await prisma.agentWakeupRequest.create({
                data: {
                    agentId: agent.id,
                    reason: "cron",
                    triggerData: JSON.stringify({ schedule }),
                    status: "queued",
                    idempotencyKey,
                    maxRetries: (0, retry_policy_service_1.resolveMaxRetries)(agent.runtimeConfig),
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
}
async function runHeartbeatScheduler(deps, config = {}) {
    const logger = deps.logger ?? noopLogger;
    const queue = await processHeartbeatQueue(deps, config);
    const schedule = await enqueueScheduledHeartbeatWakeups(deps, config);
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
    return {
        ...queue,
        ...schedule,
    };
}
function cronMatchesNow(expression, now = new Date()) {
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
