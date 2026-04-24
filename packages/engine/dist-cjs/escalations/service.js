"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESCALATION_QUEUE_SYNC_KEY = void 0;
exports.getEscalationQueueOverview = getEscalationQueueOverview;
exports.getEscalationItemById = getEscalationItemById;
exports.updateEscalationItem = updateEscalationItem;
exports.syncEscalationQueue = syncEscalationQueue;
exports.summarizeEscalations = summarizeEscalations;
const node_crypto_1 = require("node:crypto");
const action_engine_1 = require("../ai/action-engine");
const server_runs_1 = require("../ai/server-runs");
const prisma_1 = require("../prisma");
const sync_state_1 = require("../sync-state");
const WORK_REPORT_SIGNAL_SOURCE = "ai_run:work_report_signal_packet";
exports.ESCALATION_QUEUE_SYNC_KEY = "escalation_queue";
const defaultEscalationStore = {
    upsert(args) {
        return prisma_1.prisma.escalationItem.upsert(args);
    },
    findMany(args) {
        return prisma_1.prisma.escalationItem.findMany({
            where: args?.where,
            take: args?.take,
        });
    },
    findUnique(args) {
        return prisma_1.prisma.escalationItem.findUnique(args);
    },
    update(args) {
        return prisma_1.prisma.escalationItem.update(args);
    },
};
const defaultMemberLookup = async (memberId) => {
    const member = await prisma_1.prisma.teamMember.findUnique({
        where: { id: memberId },
        select: {
            id: true,
            name: true,
            role: true,
        },
    });
    if (!member) {
        return null;
    }
    return {
        id: member.id,
        name: member.name,
        role: member.role,
    };
};
async function getEscalationQueueOverview(query = {}, deps = {}) {
    const escalationStore = deps.escalationStore ?? defaultEscalationStore;
    const sync = await (0, sync_state_1.getDerivedSyncCheckpoint)(exports.ESCALATION_QUEUE_SYNC_KEY, {
        syncStore: deps.syncStore,
    });
    const now = deps.now ?? (() => new Date());
    const records = await escalationStore.findMany({
        where: {
            ...(query.projectId ? { projectId: query.projectId } : {}),
            ...(query.urgency ? { urgency: query.urgency } : {}),
        },
    });
    const items = records
        .map((record) => serializeEscalationRecord(record, now()))
        .filter((record) => {
        if (!query.includeResolved && record.queueStatus === "resolved") {
            return false;
        }
        if (query.queueStatus && record.queueStatus !== query.queueStatus) {
            return false;
        }
        return true;
    })
        .sort(compareEscalations)
        .slice(0, sanitizeLimit(query.limit));
    return {
        syncedAt: sync?.lastCompletedAt ?? sync?.lastSuccessAt ?? null,
        summary: summarizeEscalations(items),
        items,
        sync,
    };
}
async function getEscalationItemById(id, deps = {}) {
    const escalationStore = deps.escalationStore ?? defaultEscalationStore;
    const now = deps.now ?? (() => new Date());
    const record = await escalationStore.findUnique({
        where: { id },
    });
    return record ? serializeEscalationRecord(record, now()) : null;
}
async function updateEscalationItem(id, input, deps = {}) {
    const escalationStore = deps.escalationStore ?? defaultEscalationStore;
    const lookupMember = deps.lookupMember ?? defaultMemberLookup;
    const now = deps.now ?? (() => new Date());
    const existing = await escalationStore.findUnique({
        where: { id },
    });
    if (!existing) {
        return null;
    }
    const nextQueueStatus = input.queueStatus ?? normalizeQueueStatus(existing.queueStatus);
    if (normalizeSourceStatus(existing.sourceStatus) === "resolved" && nextQueueStatus !== "resolved") {
        throw new Error("Resolved source items cannot be reopened manually.");
    }
    let ownerId = existing.ownerId;
    let ownerName = existing.ownerName;
    let ownerRole = existing.ownerRole;
    if (input.ownerId !== undefined) {
        if (!input.ownerId) {
            ownerId = null;
            ownerName = null;
            ownerRole = null;
        }
        else {
            const member = await lookupMember(input.ownerId);
            if (!member) {
                throw new Error(`Owner ${input.ownerId} was not found.`);
            }
            ownerId = member.id;
            ownerName = member.name;
            ownerRole = member.role;
        }
    }
    const timestamp = now();
    const acknowledgedAt = nextQueueStatus === "acknowledged" || nextQueueStatus === "resolved"
        ? existing.acknowledgedAt ?? timestamp
        : null;
    const resolvedAt = nextQueueStatus === "resolved" ? existing.resolvedAt ?? timestamp : null;
    const updated = await escalationStore.update({
        where: { id },
        data: {
            ownerId,
            ownerName,
            ownerRole,
            queueStatus: nextQueueStatus,
            acknowledgedAt,
            resolvedAt,
        },
    });
    return serializeEscalationRecord(updated, timestamp);
}
async function syncEscalationQueue(deps = {}) {
    const escalationStore = deps.escalationStore ?? defaultEscalationStore;
    const listRunEntries = deps.listRunEntries ?? server_runs_1.listServerAIRunEntries;
    const now = deps.now ?? (() => new Date());
    const timestamp = now();
    await (0, sync_state_1.markDerivedSyncStarted)(exports.ESCALATION_QUEUE_SYNC_KEY, {
        now: deps.now,
        syncStore: deps.syncStore,
    });
    try {
        const runEntries = await listRunEntries();
        const existing = await escalationStore.findMany({
            where: {
                sourceType: WORK_REPORT_SIGNAL_SOURCE,
            },
        });
        const existingByKey = new Map(existing.map((record) => [buildCompositeKey(record), record]));
        const activeKeys = new Set();
        await Promise.all(runEntries
            .map(mapRunEntryToEscalationInput)
            .filter((input) => input !== null)
            .map(async (input) => {
            const key = buildCompositeKey(input);
            activeKeys.add(key);
            const existingRecord = existingByKey.get(key);
            const preservedQueueStatus = existingRecord && normalizeQueueStatus(existingRecord.queueStatus) === "acknowledged"
                ? "acknowledged"
                : "open";
            await escalationStore.upsert({
                where: {
                    sourceType_entityType_entityRef: {
                        sourceType: input.sourceType,
                        entityType: input.entityType,
                        entityRef: input.entityRef,
                    },
                },
                create: {
                    id: (0, node_crypto_1.randomUUID)(),
                    ...toEscalationWriteShape(input, {
                        queueStatus: "open",
                        ownerId: null,
                        ownerName: null,
                        ownerRole: null,
                        firstObservedAt: input.firstObservedAt,
                        acknowledgedAt: null,
                        resolvedAt: null,
                    }),
                },
                update: toEscalationWriteShape(input, {
                    queueStatus: existingRecord && normalizeQueueStatus(existingRecord.queueStatus) === "resolved"
                        ? "open"
                        : preservedQueueStatus,
                    ownerId: existingRecord?.ownerId ?? null,
                    ownerName: existingRecord?.ownerName ?? null,
                    ownerRole: existingRecord?.ownerRole ?? null,
                    firstObservedAt: existingRecord?.firstObservedAt.toISOString() ?? input.firstObservedAt,
                    acknowledgedAt: preservedQueueStatus === "acknowledged"
                        ? existingRecord?.acknowledgedAt?.toISOString() ?? input.lastObservedAt
                        : null,
                    resolvedAt: null,
                }),
            });
        }));
        await Promise.all(existing
            .filter((record) => !activeKeys.has(buildCompositeKey(record)))
            .filter((record) => normalizeQueueStatus(record.queueStatus) !== "resolved" || normalizeSourceStatus(record.sourceStatus) !== "resolved")
            .map((record) => escalationStore.update({
            where: { id: record.id },
            data: {
                queueStatus: "resolved",
                sourceStatus: "resolved",
                acknowledgedAt: record.acknowledgedAt ?? timestamp,
                resolvedAt: record.resolvedAt ?? timestamp,
            },
        })));
        await (0, sync_state_1.markDerivedSyncSuccess)(exports.ESCALATION_QUEUE_SYNC_KEY, {
            metadata: {
                runEntryCount: runEntries.length,
                activeQueueItems: activeKeys.size,
                sourceType: WORK_REPORT_SIGNAL_SOURCE,
            },
            resultCount: activeKeys.size,
        }, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
    }
    catch (error) {
        await (0, sync_state_1.markDerivedSyncError)(exports.ESCALATION_QUEUE_SYNC_KEY, error, {
            metadata: {
                sourceType: WORK_REPORT_SIGNAL_SOURCE,
            },
        }, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
        throw error;
    }
}
function summarizeEscalations(items) {
    return items.reduce((accumulator, item) => {
        accumulator.total += 1;
        accumulator[item.queueStatus] += 1;
        if (item.urgency === "critical") {
            accumulator.critical += 1;
        }
        if (item.urgency === "high") {
            accumulator.high += 1;
        }
        if (item.slaState === "due_soon") {
            accumulator.dueSoon += 1;
        }
        if (item.slaState === "breached") {
            accumulator.breached += 1;
        }
        if (!item.owner) {
            accumulator.unassigned += 1;
        }
        return accumulator;
    }, {
        total: 0,
        open: 0,
        acknowledged: 0,
        resolved: 0,
        critical: 0,
        high: 0,
        dueSoon: 0,
        breached: 0,
        unassigned: 0,
    });
}
function mapRunEntryToEscalationInput(entry) {
    const source = entry.input.source;
    if (!source || source.workflow !== "work_report_signal_packet") {
        return null;
    }
    const sourceStatus = resolveSourceStatus(entry);
    if (sourceStatus === "resolved") {
        return null;
    }
    const purpose = source.purpose ?? null;
    const proposal = entry.run.result?.proposal ?? null;
    const purposeLabel = formatPurposeLabel(purpose);
    return {
        sourceType: WORK_REPORT_SIGNAL_SOURCE,
        sourceRef: source.packetId ?? entry.run.id,
        entityType: "ai_run",
        entityRef: entry.run.id,
        projectId: source.projectId ?? null,
        projectName: source.projectName ?? null,
        title: sourceStatus === "needs_approval" && proposal?.title
            ? proposal.title
            : `${purposeLabel} · ${source.entityLabel}`,
        summary: buildEscalationSummary(entry, sourceStatus, purposeLabel),
        purpose,
        urgency: resolveUrgency(entry, sourceStatus),
        sourceStatus,
        firstObservedAt: entry.run.createdAt,
        lastObservedAt: entry.run.updatedAt,
        slaTargetAt: new Date(new Date(entry.run.createdAt).getTime() + resolveSlaWindowHours(resolveUrgency(entry, sourceStatus)) * 60 * 60 * 1000).toISOString(),
        metadata: {
            runId: entry.run.id,
            agentId: entry.run.agentId,
            packetId: source.packetId,
            packetLabel: source.packetLabel,
            purposeLabel,
            proposalId: proposal?.id,
            proposalType: proposal?.type,
            proposalItemCount: proposal ? (0, action_engine_1.getProposalItemCount)(proposal) : undefined,
            tracePath: `/api/ai/runs/${entry.run.id}/trace`,
        },
    };
}
function buildEscalationSummary(entry, sourceStatus, purposeLabel) {
    const proposal = entry.run.result?.proposal ?? null;
    switch (sourceStatus) {
        case "needs_approval":
            return proposal?.summary ?? `${purposeLabel} is waiting for operator approval.`;
        case "failed":
            return entry.run.errorMessage?.trim()
                ? entry.run.errorMessage
                : `${purposeLabel} failed before producing a stable approval package.`;
        case "running":
            return `${purposeLabel} is still running and has not produced a stable result yet.`;
        case "queued":
        default:
            return `${purposeLabel} is queued and still waiting for execution.`;
    }
}
function resolveSourceStatus(entry) {
    const proposalState = entry.run.result?.proposal?.state;
    if (entry.run.status === "failed") {
        return "failed";
    }
    if (proposalState === "pending" || entry.run.status === "needs_approval") {
        return "needs_approval";
    }
    if (entry.run.status === "running") {
        return "running";
    }
    if (entry.run.status === "queued") {
        return "queued";
    }
    if (proposalState === "applied" || proposalState === "dismissed" || entry.run.status === "done") {
        return "resolved";
    }
    return "resolved";
}
function resolveUrgency(entry, sourceStatus) {
    const purpose = entry.input.source?.purpose;
    const proposalType = entry.run.result?.proposal?.type;
    if (sourceStatus === "failed") {
        return purpose === "risks" ? "critical" : "high";
    }
    if (purpose === "risks" || proposalType === "raise_risks") {
        return "high";
    }
    if (purpose === "status" || proposalType === "draft_status_report") {
        return sourceStatus === "needs_approval" ? "high" : "medium";
    }
    if (proposalType === "reschedule_tasks") {
        return "high";
    }
    return sourceStatus === "queued" ? "low" : "medium";
}
function resolveSlaWindowHours(urgency) {
    switch (urgency) {
        case "critical":
            return 4;
        case "high":
            return 8;
        case "medium":
            return 24;
        case "low":
        default:
            return 48;
    }
}
function serializeEscalationRecord(record, now) {
    const queueStatus = normalizeQueueStatus(record.queueStatus);
    const sourceStatus = normalizeSourceStatus(record.sourceStatus);
    const urgency = normalizeUrgency(record.urgency);
    const metadata = parseMetadata(record.metadataJson);
    return {
        id: record.id,
        sourceType: record.sourceType,
        sourceRef: record.sourceRef,
        entityType: record.entityType,
        entityRef: record.entityRef,
        projectId: record.projectId,
        projectName: record.projectName,
        title: record.title,
        summary: record.summary,
        purpose: record.purpose,
        urgency,
        queueStatus,
        sourceStatus,
        owner: record.ownerId && record.ownerName
            ? {
                id: record.ownerId,
                name: record.ownerName,
                role: record.ownerRole,
            }
            : null,
        recommendedOwnerRole: resolveRecommendedOwnerRole(record.purpose),
        firstObservedAt: record.firstObservedAt.toISOString(),
        lastObservedAt: record.lastObservedAt.toISOString(),
        acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: record.resolvedAt?.toISOString() ?? null,
        slaTargetAt: record.slaTargetAt.toISOString(),
        slaState: resolveSlaState(queueStatus, record.slaTargetAt, now),
        ageHours: calculateAgeHours(record.firstObservedAt, now),
        metadata,
    };
}
function toEscalationWriteShape(input, state) {
    return {
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        entityType: input.entityType,
        entityRef: input.entityRef,
        projectId: input.projectId,
        projectName: input.projectName,
        title: input.title,
        summary: input.summary,
        purpose: input.purpose,
        urgency: input.urgency,
        queueStatus: state.queueStatus,
        sourceStatus: input.sourceStatus,
        ownerId: state.ownerId,
        ownerName: state.ownerName,
        ownerRole: state.ownerRole,
        firstObservedAt: new Date(state.firstObservedAt),
        lastObservedAt: new Date(input.lastObservedAt),
        acknowledgedAt: state.acknowledgedAt ? new Date(state.acknowledgedAt) : null,
        resolvedAt: state.resolvedAt ? new Date(state.resolvedAt) : null,
        slaTargetAt: new Date(input.slaTargetAt),
        metadataJson: JSON.stringify(input.metadata),
        updatedAt: new Date(),
    };
}
function parseMetadata(value) {
    if (!value) {
        return {};
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return {};
    }
}
function buildCompositeKey(input) {
    return `${input.sourceType}:${input.entityType}:${input.entityRef}`;
}
function compareEscalations(left, right) {
    const leftPriority = urgencyPriority(left.urgency);
    const rightPriority = urgencyPriority(right.urgency);
    if (left.slaState !== right.slaState) {
        return slaPriority(left.slaState) - slaPriority(right.slaState);
    }
    if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
    }
    return left.slaTargetAt.localeCompare(right.slaTargetAt);
}
function urgencyPriority(value) {
    switch (value) {
        case "critical":
            return 0;
        case "high":
            return 1;
        case "medium":
            return 2;
        case "low":
        default:
            return 3;
    }
}
function slaPriority(value) {
    switch (value) {
        case "breached":
            return 0;
        case "due_soon":
            return 1;
        case "on_track":
            return 2;
        case "resolved":
        default:
            return 3;
    }
}
function resolveSlaState(queueStatus, slaTargetAt, now) {
    if (queueStatus === "resolved") {
        return "resolved";
    }
    const deltaMs = slaTargetAt.getTime() - now.getTime();
    if (deltaMs <= 0) {
        return "breached";
    }
    if (deltaMs <= 2 * 60 * 60 * 1000) {
        return "due_soon";
    }
    return "on_track";
}
function calculateAgeHours(firstObservedAt, now) {
    return Math.max(0, Math.round(((now.getTime() - firstObservedAt.getTime()) / (60 * 60 * 1000)) * 10) / 10);
}
function resolveRecommendedOwnerRole(purpose) {
    switch (purpose) {
        case "tasks":
            return "OPS";
        case "status":
            return "EXEC";
        case "risks":
        default:
            return "PM";
    }
}
function formatPurposeLabel(purpose) {
    switch (purpose) {
        case "tasks":
            return "Execution patch";
        case "risks":
            return "Risk additions";
        case "status":
            return "Executive status draft";
        default:
            return "Operator escalation";
    }
}
function normalizeQueueStatus(value) {
    if (value === "acknowledged" || value === "resolved") {
        return value;
    }
    return "open";
}
function normalizeSourceStatus(value) {
    if (value === "queued" ||
        value === "running" ||
        value === "needs_approval" ||
        value === "failed" ||
        value === "resolved") {
        return value;
    }
    return "queued";
}
function normalizeUrgency(value) {
    if (value === "critical" || value === "high" || value === "low") {
        return value;
    }
    return "medium";
}
function sanitizeLimit(limit) {
    if (!limit || !Number.isFinite(limit)) {
        return 8;
    }
    return Math.max(1, Math.min(24, Math.round(limit)));
}
