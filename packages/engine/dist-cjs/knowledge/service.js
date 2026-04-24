"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKnowledgeLoopOverview = getKnowledgeLoopOverview;
const safety_1 = require("../ai/safety");
const service_1 = require("../escalations/service");
async function getKnowledgeLoopOverview(query = {}, deps = {}) {
    const now = deps.now ?? (() => new Date());
    const getEscalations = deps.getEscalations ?? service_1.getEscalationQueueOverview;
    const escalations = deps.escalations ??
        (await getEscalations({
            includeResolved: true,
            limit: deriveEscalationLimit(query.limit),
            ...(query.projectId ? { projectId: query.projectId } : {}),
        }));
    const groups = buildPatternGroups(escalations.items);
    const playbooks = groups
        .map(buildPlaybook)
        .sort((left, right) => {
        if (right.totalOccurrences !== left.totalOccurrences) {
            return right.totalOccurrences - left.totalOccurrences;
        }
        return right.benchmark.resolutionRate - left.benchmark.resolutionRate;
    })
        .slice(0, sanitizeLimit(query.limit));
    const activeGuidance = buildActiveGuidance(escalations.items, playbooks).slice(0, sanitizeLimit(query.limit));
    return {
        generatedAt: escalations.syncedAt ?? now().toISOString(),
        summary: {
            totalPlaybooks: playbooks.length,
            repeatedPlaybooks: playbooks.filter((item) => item.maturity === "repeated").length,
            benchmarkedGuidance: activeGuidance.length,
            trackedPatterns: groups.length,
        },
        playbooks,
        activeGuidance,
    };
}
function buildPatternGroups(items) {
    const groups = new Map();
    for (const item of items) {
        const proposalType = isProposalType(item.metadata.proposalType)
            ? item.metadata.proposalType
            : null;
        const purpose = item.purpose ?? null;
        const key = [proposalType ?? "unknown", purpose ?? "none"].join("|");
        const current = groups.get(key) ?? {
            key,
            proposalType,
            purpose,
            items: [],
        };
        current.items.push(item);
        groups.set(key, current);
    }
    return Array.from(groups.values());
}
function buildPlaybook(group) {
    const safety = group.proposalType
        ? getProposalSafetyProfileByType(group.proposalType)
        : null;
    const benchmark = buildBenchmark(group.items);
    const maturity = group.items.length >= 2 ? "repeated" : "emerging";
    const title = buildPlaybookTitle(group.proposalType, group.purpose);
    const lessons = buildLessons(group.items, benchmark, safety?.compensationSummary ?? null);
    return {
        id: `playbook:${group.key}`,
        title,
        patternKey: group.key,
        proposalType: group.proposalType,
        purpose: group.purpose,
        maturity,
        totalOccurrences: group.items.length,
        openOccurrences: group.items.filter((item) => item.queueStatus !== "resolved").length,
        resolvedOccurrences: group.items.filter((item) => item.queueStatus === "resolved").length,
        benchmark,
        mutationSurface: safety?.mutationSurface ?? "Operator escalation follow-up",
        compensationMode: safety?.compensationMode ?? "follow_up_patch",
        guidance: buildGuidanceText(group, benchmark, safety?.compensationSummary ?? null),
        lessons,
    };
}
function buildActiveGuidance(items, playbooks) {
    const playbookByKey = new Map(playbooks.map((playbook) => [playbook.patternKey, playbook]));
    return items
        .filter((item) => item.queueStatus !== "resolved")
        .map((item) => {
        const patternKey = [item.metadata.proposalType ?? "unknown", item.purpose ?? "none"].join("|");
        const playbook = playbookByKey.get(patternKey);
        if (!playbook) {
            return null;
        }
        return {
            escalationId: item.id,
            projectName: item.projectName,
            title: item.title,
            urgency: item.urgency,
            queueStatus: item.queueStatus,
            playbookId: playbook.id,
            playbookTitle: playbook.title,
            benchmarkSummary: buildBenchmarkSummary(playbook.benchmark),
            recommendedAction: buildGuidanceAction(item, playbook),
        };
    })
        .filter((item) => item !== null)
        .sort((left, right) => urgencyPriority(left.urgency) - urgencyPriority(right.urgency));
}
function buildBenchmark(items) {
    const ackHours = items
        .filter((item) => item.acknowledgedAt)
        .map((item) => hoursBetween(item.firstObservedAt, item.acknowledgedAt));
    const observedAckHours = average(ackHours);
    const fallbackAckHours = average(items.map((item) => hoursBetween(item.firstObservedAt, item.slaTargetAt) / 2));
    const ownerRole = mostCommonRole(items);
    const resolutionRate = ratio(items.filter((item) => item.queueStatus === "resolved").length, items.length);
    const breachRate = ratio(items.filter((item) => item.slaState === "breached").length, items.length);
    return {
        ownerRole,
        ackTargetHours: round(Math.max(observedAckHours ?? fallbackAckHours ?? 8, 0.5), 1),
        resolutionRate: round(resolutionRate, 2),
        breachRate: round(breachRate, 2),
        source: observedAckHours !== null ? "observed_history" : "sla_window",
    };
}
function buildPlaybookTitle(proposalType, purpose) {
    if (proposalType === "create_tasks")
        return "Task drafting playbook";
    if (proposalType === "update_tasks")
        return "Execution patch playbook";
    if (proposalType === "reschedule_tasks")
        return "Schedule recovery playbook";
    if (proposalType === "raise_risks")
        return "Risk surfacing playbook";
    if (proposalType === "draft_status_report")
        return "Executive narrative playbook";
    if (proposalType === "notify_team")
        return "Team communication playbook";
    if (purpose === "tasks")
        return "Task intervention playbook";
    if (purpose === "risks")
        return "Risk intervention playbook";
    if (purpose === "status")
        return "Status intervention playbook";
    return "Operator follow-up playbook";
}
function buildGuidanceText(group, benchmark, compensationSummary) {
    const title = buildPlaybookTitle(group.proposalType, group.purpose);
    const ownerRole = benchmark.ownerRole ?? "the designated operator";
    const compensationTail = compensationSummary
        ? ` Compensation posture: ${compensationSummary}`
        : "";
    return `${title} works best when ${ownerRole} acknowledges the item within ${benchmark.ackTargetHours}h and drives it before the SLA window collapses.${compensationTail}`;
}
function buildLessons(items, benchmark, compensationSummary) {
    const lessons = new Set();
    if (items.some((item) => !item.owner)) {
        lessons.add(`First move is explicit owner assignment${benchmark.ownerRole ? ` to ${benchmark.ownerRole}` : ""}.`);
    }
    if (benchmark.breachRate > 0) {
        lessons.add("Patterns that drift past SLA should be escalated before the next operator cycle.");
    }
    if (benchmark.resolutionRate >= 0.5) {
        lessons.add("This pattern has a usable closeout history, so benchmark guidance can be reused instead of improvising each time.");
    }
    else {
        lessons.add("This pattern is still immature; benchmark timing is advisory and should be reviewed by an operator.");
    }
    if (compensationSummary) {
        lessons.add(compensationSummary);
    }
    return Array.from(lessons).slice(0, 3);
}
function buildBenchmarkSummary(benchmark) {
    const ownerLabel = benchmark.ownerRole ? `${benchmark.ownerRole} owner` : "named owner";
    return `${ownerLabel} · acknowledge within ${benchmark.ackTargetHours}h · resolution rate ${Math.round(benchmark.resolutionRate * 100)}%`;
}
function buildGuidanceAction(item, playbook) {
    const ownerLabel = playbook.benchmark.ownerRole ?? item.recommendedOwnerRole ?? "operator";
    const opening = item.queueStatus === "open"
        ? `Assign ${ownerLabel} now and acknowledge this ${item.urgency} item within ${playbook.benchmark.ackTargetHours}h.`
        : `Keep ${ownerLabel} on the item and protect the benchmark window of ${playbook.benchmark.ackTargetHours}h.`;
    return `${opening} Then follow ${playbook.title.toLowerCase()} and keep compensation posture ${playbook.compensationMode}.`;
}
function getProposalSafetyProfileByType(proposalType) {
    switch (proposalType) {
        case "create_tasks":
            return (0, safety_1.getProposalSafetyProfile)(createSafetyTemplateProposal("create_tasks"));
        case "update_tasks":
            return (0, safety_1.getProposalSafetyProfile)(createSafetyTemplateProposal("update_tasks"));
        case "reschedule_tasks":
            return (0, safety_1.getProposalSafetyProfile)(createSafetyTemplateProposal("reschedule_tasks"));
        case "raise_risks":
            return (0, safety_1.getProposalSafetyProfile)(createSafetyTemplateProposal("raise_risks"));
        case "draft_status_report":
            return (0, safety_1.getProposalSafetyProfile)(createSafetyTemplateProposal("draft_status_report"));
        case "notify_team":
            return (0, safety_1.getProposalSafetyProfile)(createSafetyTemplateProposal("notify_team"));
        default:
            return null;
    }
}
function createSafetyTemplateProposal(type) {
    const base = {
        id: "knowledge-playbook-template",
        title: "Knowledge loop template",
        summary: "Template proposal used to derive operator safety posture.",
        state: "pending",
        tasks: [],
    };
    switch (type) {
        case "create_tasks":
            return {
                ...base,
                type,
                tasks: [
                    {
                        projectId: "template-project",
                        title: "Draft next operator action",
                        description: "Benchmark-backed operator task draft.",
                        assignee: "Operator",
                        dueDate: "2026-03-12",
                        priority: "medium",
                        reason: "Template draft for knowledge-loop safety mapping.",
                    },
                ],
            };
        case "update_tasks":
            return {
                ...base,
                type,
                taskUpdates: [
                    {
                        taskId: "template-task",
                        title: "Patch existing operator task",
                        reason: "Template patch for knowledge-loop safety mapping.",
                    },
                ],
            };
        case "reschedule_tasks":
            return {
                ...base,
                type,
                taskReschedules: [
                    {
                        taskId: "template-task",
                        title: "Move follow-up date",
                        previousDueDate: "2026-03-11",
                        newDueDate: "2026-03-12",
                        reason: "Template reschedule for knowledge-loop safety mapping.",
                    },
                ],
            };
        case "raise_risks":
            return {
                ...base,
                type,
                risks: [
                    {
                        projectId: "template-project",
                        title: "Surface repeated blocker",
                        description: "Template risk record for safety posture.",
                        owner: "Operator",
                        probability: 50,
                        impact: 50,
                        mitigation: "Escalate and assign owner.",
                        reason: "Template risk for knowledge-loop safety mapping.",
                    },
                ],
            };
        case "draft_status_report":
            return {
                ...base,
                type,
                statusReport: {
                    projectId: "template-project",
                    title: "Executive follow-up",
                    audience: "Executive PMO",
                    channel: "email",
                    summary: "Template report summary.",
                    body: "Template report body.",
                    reason: "Template report for knowledge-loop safety mapping.",
                },
            };
        case "notify_team":
            return {
                ...base,
                type,
                notifications: [
                    {
                        channel: "telegram",
                        recipients: ["Operator"],
                        message: "Template message.",
                        reason: "Template notification for knowledge-loop safety mapping.",
                    },
                ],
            };
    }
}
function isProposalType(value) {
    return (value === "create_tasks" ||
        value === "update_tasks" ||
        value === "reschedule_tasks" ||
        value === "raise_risks" ||
        value === "draft_status_report" ||
        value === "notify_team");
}
function deriveEscalationLimit(limit) {
    const safeLimit = sanitizeLimit(limit);
    return Math.max(safeLimit * 6, 24);
}
function sanitizeLimit(limit) {
    if (!Number.isFinite(limit)) {
        return 4;
    }
    return Math.min(Math.max(Math.trunc(limit ?? 4), 1), 8);
}
function mostCommonRole(items) {
    const roles = new Map();
    for (const item of items) {
        const role = item.owner?.role ?? item.recommendedOwnerRole ?? null;
        if (!role)
            continue;
        roles.set(role, (roles.get(role) ?? 0) + 1);
    }
    return Array.from(roles.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}
function hoursBetween(left, right) {
    return (Date.parse(right) - Date.parse(left)) / (1000 * 60 * 60);
}
function average(values) {
    if (values.length === 0)
        return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function ratio(value, total) {
    if (total === 0)
        return 0;
    return value / total;
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
function round(value, precision) {
    const multiplier = 10 ** precision;
    return Math.round(value * multiplier) / multiplier;
}
