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
import { getProposalItemCount } from '../ai/action-engine.js';
import { listServerAIRunEntries } from '../ai/server-runs.js';
import { prisma } from '../prisma.js';
import { getDerivedSyncCheckpoint, markDerivedSyncError, markDerivedSyncStarted, markDerivedSyncSuccess, } from '../sync-state/index.js';
const WORK_REPORT_SIGNAL_SOURCE = "ai_run:work_report_signal_packet";
export const ESCALATION_QUEUE_SYNC_KEY = "escalation_queue";
const defaultEscalationStore = {
    upsert(args) {
        return prisma.escalationItem.upsert(args);
    },
    findMany(args) {
        return prisma.escalationItem.findMany({
            where: args === null || args === void 0 ? void 0 : args.where,
            take: args === null || args === void 0 ? void 0 : args.take,
        });
    },
    findUnique(args) {
        return prisma.escalationItem.findUnique(args);
    },
    update(args) {
        return prisma.escalationItem.update(args);
    },
};
const defaultMemberLookup = (memberId) => __awaiter(void 0, void 0, void 0, function* () {
    const member = yield prisma.teamMember.findUnique({
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
});
export function getEscalationQueueOverview() {
    return __awaiter(this, arguments, void 0, function* (query = {}, deps = {}) {
        var _a, _b, _c, _d;
        const escalationStore = (_a = deps.escalationStore) !== null && _a !== void 0 ? _a : defaultEscalationStore;
        const sync = yield getDerivedSyncCheckpoint(ESCALATION_QUEUE_SYNC_KEY, {
            syncStore: deps.syncStore,
        });
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const records = yield escalationStore.findMany({
            where: Object.assign(Object.assign({}, (query.projectId ? { projectId: query.projectId } : {})), (query.urgency ? { urgency: query.urgency } : {})),
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
            syncedAt: (_d = (_c = sync === null || sync === void 0 ? void 0 : sync.lastCompletedAt) !== null && _c !== void 0 ? _c : sync === null || sync === void 0 ? void 0 : sync.lastSuccessAt) !== null && _d !== void 0 ? _d : null,
            summary: summarizeEscalations(items),
            items,
            sync,
        };
    });
}
export function getEscalationItemById(id_1) {
    return __awaiter(this, arguments, void 0, function* (id, deps = {}) {
        var _a, _b;
        const escalationStore = (_a = deps.escalationStore) !== null && _a !== void 0 ? _a : defaultEscalationStore;
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const record = yield escalationStore.findUnique({
            where: { id },
        });
        return record ? serializeEscalationRecord(record, now()) : null;
    });
}
export function updateEscalationItem(id_1, input_1) {
    return __awaiter(this, arguments, void 0, function* (id, input, deps = {}) {
        var _a, _b, _c, _d, _e, _f;
        const escalationStore = (_a = deps.escalationStore) !== null && _a !== void 0 ? _a : defaultEscalationStore;
        const lookupMember = (_b = deps.lookupMember) !== null && _b !== void 0 ? _b : defaultMemberLookup;
        const now = (_c = deps.now) !== null && _c !== void 0 ? _c : (() => new Date());
        const existing = yield escalationStore.findUnique({
            where: { id },
        });
        if (!existing) {
            return null;
        }
        const nextQueueStatus = (_d = input.queueStatus) !== null && _d !== void 0 ? _d : normalizeQueueStatus(existing.queueStatus);
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
                const member = yield lookupMember(input.ownerId);
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
            ? (_e = existing.acknowledgedAt) !== null && _e !== void 0 ? _e : timestamp
            : null;
        const resolvedAt = nextQueueStatus === "resolved" ? (_f = existing.resolvedAt) !== null && _f !== void 0 ? _f : timestamp : null;
        const updated = yield escalationStore.update({
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
    });
}
export function syncEscalationQueue() {
    return __awaiter(this, arguments, void 0, function* (deps = {}) {
        var _a, _b, _c;
        const escalationStore = (_a = deps.escalationStore) !== null && _a !== void 0 ? _a : defaultEscalationStore;
        const listRunEntries = (_b = deps.listRunEntries) !== null && _b !== void 0 ? _b : listServerAIRunEntries;
        const now = (_c = deps.now) !== null && _c !== void 0 ? _c : (() => new Date());
        const timestamp = now();
        yield markDerivedSyncStarted(ESCALATION_QUEUE_SYNC_KEY, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
        try {
            const runEntries = yield listRunEntries();
            const existing = yield escalationStore.findMany({
                where: {
                    sourceType: WORK_REPORT_SIGNAL_SOURCE,
                },
            });
            const existingByKey = new Map(existing.map((record) => [buildCompositeKey(record), record]));
            const activeKeys = new Set();
            yield Promise.all(runEntries
                .map(mapRunEntryToEscalationInput)
                .filter((input) => input !== null)
                .map((input) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                const key = buildCompositeKey(input);
                activeKeys.add(key);
                const existingRecord = existingByKey.get(key);
                const preservedQueueStatus = existingRecord && normalizeQueueStatus(existingRecord.queueStatus) === "acknowledged"
                    ? "acknowledged"
                    : "open";
                yield escalationStore.upsert({
                    where: {
                        sourceType_entityType_entityRef: {
                            sourceType: input.sourceType,
                            entityType: input.entityType,
                            entityRef: input.entityRef,
                        },
                    },
                    create: Object.assign({ id: randomUUID() }, toEscalationWriteShape(input, {
                        queueStatus: "open",
                        ownerId: null,
                        ownerName: null,
                        ownerRole: null,
                        firstObservedAt: input.firstObservedAt,
                        acknowledgedAt: null,
                        resolvedAt: null,
                    })),
                    update: toEscalationWriteShape(input, {
                        queueStatus: existingRecord && normalizeQueueStatus(existingRecord.queueStatus) === "resolved"
                            ? "open"
                            : preservedQueueStatus,
                        ownerId: (_a = existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.ownerId) !== null && _a !== void 0 ? _a : null,
                        ownerName: (_b = existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.ownerName) !== null && _b !== void 0 ? _b : null,
                        ownerRole: (_c = existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.ownerRole) !== null && _c !== void 0 ? _c : null,
                        firstObservedAt: (_d = existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.firstObservedAt.toISOString()) !== null && _d !== void 0 ? _d : input.firstObservedAt,
                        acknowledgedAt: preservedQueueStatus === "acknowledged"
                            ? (_f = (_e = existingRecord === null || existingRecord === void 0 ? void 0 : existingRecord.acknowledgedAt) === null || _e === void 0 ? void 0 : _e.toISOString()) !== null && _f !== void 0 ? _f : input.lastObservedAt
                            : null,
                        resolvedAt: null,
                    }),
                });
            })));
            yield Promise.all(existing
                .filter((record) => !activeKeys.has(buildCompositeKey(record)))
                .filter((record) => normalizeQueueStatus(record.queueStatus) !== "resolved" || normalizeSourceStatus(record.sourceStatus) !== "resolved")
                .map((record) => {
                var _a, _b;
                return escalationStore.update({
                    where: { id: record.id },
                    data: {
                        queueStatus: "resolved",
                        sourceStatus: "resolved",
                        acknowledgedAt: (_a = record.acknowledgedAt) !== null && _a !== void 0 ? _a : timestamp,
                        resolvedAt: (_b = record.resolvedAt) !== null && _b !== void 0 ? _b : timestamp,
                    },
                });
            }));
            yield markDerivedSyncSuccess(ESCALATION_QUEUE_SYNC_KEY, {
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
            yield markDerivedSyncError(ESCALATION_QUEUE_SYNC_KEY, error, {
                metadata: {
                    sourceType: WORK_REPORT_SIGNAL_SOURCE,
                },
            }, {
                now: deps.now,
                syncStore: deps.syncStore,
            });
            throw error;
        }
    });
}
export function summarizeEscalations(items) {
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
    var _a, _b, _c, _d, _e, _f;
    const source = entry.input.source;
    if (!source || source.workflow !== "work_report_signal_packet") {
        return null;
    }
    const sourceStatus = resolveSourceStatus(entry);
    if (sourceStatus === "resolved") {
        return null;
    }
    const purpose = (_a = source.purpose) !== null && _a !== void 0 ? _a : null;
    const proposal = (_c = (_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.proposal) !== null && _c !== void 0 ? _c : null;
    const purposeLabel = formatPurposeLabel(purpose);
    return {
        sourceType: WORK_REPORT_SIGNAL_SOURCE,
        sourceRef: (_d = source.packetId) !== null && _d !== void 0 ? _d : entry.run.id,
        entityType: "ai_run",
        entityRef: entry.run.id,
        projectId: (_e = source.projectId) !== null && _e !== void 0 ? _e : null,
        projectName: (_f = source.projectName) !== null && _f !== void 0 ? _f : null,
        title: sourceStatus === "needs_approval" && (proposal === null || proposal === void 0 ? void 0 : proposal.title)
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
            proposalId: proposal === null || proposal === void 0 ? void 0 : proposal.id,
            proposalType: proposal === null || proposal === void 0 ? void 0 : proposal.type,
            proposalItemCount: proposal ? getProposalItemCount(proposal) : undefined,
            tracePath: `/api/ai/runs/${entry.run.id}/trace`,
        },
    };
}
function buildEscalationSummary(entry, sourceStatus, purposeLabel) {
    var _a, _b, _c, _d;
    const proposal = (_b = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.proposal) !== null && _b !== void 0 ? _b : null;
    switch (sourceStatus) {
        case "needs_approval":
            return (_c = proposal === null || proposal === void 0 ? void 0 : proposal.summary) !== null && _c !== void 0 ? _c : `${purposeLabel} is waiting for operator approval.`;
        case "failed":
            return ((_d = entry.run.errorMessage) === null || _d === void 0 ? void 0 : _d.trim())
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
    var _a, _b;
    const proposalState = (_b = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.proposal) === null || _b === void 0 ? void 0 : _b.state;
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
    var _a, _b, _c;
    const purpose = (_a = entry.input.source) === null || _a === void 0 ? void 0 : _a.purpose;
    const proposalType = (_c = (_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.proposal) === null || _c === void 0 ? void 0 : _c.type;
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
    var _a, _b, _c, _d;
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
        acknowledgedAt: (_b = (_a = record.acknowledgedAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
        resolvedAt: (_d = (_c = record.resolvedAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : null,
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
    catch (_a) {
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
