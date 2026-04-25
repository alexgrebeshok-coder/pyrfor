var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getProposalItemCount, getProposalPreviewItems, getProposalSafetyProfile, } from './action-engine.js';
import { getServerAIRunEntry, } from './server-runs.js';
function formatWorkflowLabel(workflow) {
    switch (workflow) {
        case "work_report_signal_packet":
            return "Work-report signal packet";
        case "meeting_to_action":
            return "Meeting-to-action";
        default:
            return workflow.replace(/[_-]+/g, " ");
    }
}
function formatPurposeLabel(purpose) {
    if (!purpose)
        return null;
    switch (purpose) {
        case "tasks":
            return "Execution patch";
        case "risks":
            return "Risk additions";
        case "status":
            return "Executive status draft";
        default:
            return purpose.replace(/[_-]+/g, " ");
    }
}
function formatReplayLabel(replayOfRunId) {
    if (!replayOfRunId)
        return null;
    return `Replay of ${replayOfRunId}`;
}
function trimPrompt(prompt, maxLength = 360) {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
}
function resolveSource(entry) {
    var _a;
    const source = entry.input.source;
    if (source) {
        return Object.assign(Object.assign({}, source), { workflowLabel: formatWorkflowLabel(source.workflow), purposeLabel: formatPurposeLabel(source.purpose), replayLabel: formatReplayLabel(source.replayOfRunId) });
    }
    return {
        workflow: "direct_ai_run",
        workflowLabel: "Direct AI run",
        purposeLabel: null,
        replayLabel: null,
        entityType: entry.run.context.type,
        entityId: (_a = entry.run.context.projectId) !== null && _a !== void 0 ? _a : entry.run.id,
        entityLabel: entry.run.context.title,
    };
}
function resolveFacts(entry) {
    var _a, _b, _c, _d;
    const ctx = (_a = entry.input.context) !== null && _a !== void 0 ? _a : {};
    const currentProjectId = (_c = (_b = ctx.project) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : (_d = ctx.activeContext) === null || _d === void 0 ? void 0 : _d.projectId;
    const risks = Array.isArray(ctx.risks) ? ctx.risks : [];
    const relevantRisks = currentProjectId
        ? risks.filter((risk) => risk.projectId === currentProjectId)
        : risks;
    return {
        projects: Array.isArray(ctx.projects) ? ctx.projects.length : 0,
        tasks: (Array.isArray(ctx.projectTasks) ? ctx.projectTasks : Array.isArray(ctx.tasks) ? ctx.tasks : []).length,
        risks: relevantRisks.length,
        team: Array.isArray(ctx.team) ? ctx.team.length : 0,
        notifications: Array.isArray(ctx.notifications) ? ctx.notifications.length : 0,
    };
}
function resolveModelName(entry) {
    var _a, _b, _c;
    const collaborationRuntime = (_b = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.collaboration) === null || _b === void 0 ? void 0 : _b.leaderRuntime;
    if (collaborationRuntime) {
        return `${collaborationRuntime.provider}/${collaborationRuntime.model}`;
    }
    if (entry.origin === "gateway") {
        return ((_c = process.env.OPENCLAW_GATEWAY_MODEL) === null || _c === void 0 ? void 0 : _c.trim()) || "openclaw:main";
    }
    return "mock-adapter";
}
function resolveModelStatus(status) {
    switch (status) {
        case "queued":
            return "pending";
        case "running":
            return "running";
        case "failed":
            return "failed";
        case "needs_approval":
        case "done":
        default:
            return "done";
    }
}
function resolveProposalStatus(entry) {
    var _a;
    if ((_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.proposal) {
        return "done";
    }
    switch (entry.run.status) {
        case "queued":
            return "pending";
        case "running":
            return "running";
        case "failed":
            return "failed";
        case "needs_approval":
        case "done":
        default:
            return "not_applicable";
    }
}
function resolveApplyStatus(entry) {
    var _a, _b, _c;
    if ((_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.actionResult) {
        return "done";
    }
    const proposalState = (_c = (_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.proposal) === null || _c === void 0 ? void 0 : _c.state;
    if (proposalState === "pending") {
        return "pending";
    }
    if (proposalState === "applied") {
        return "done";
    }
    if (proposalState === "dismissed") {
        return "not_applicable";
    }
    return "not_applicable";
}
function buildProposalSummary(entry) {
    var _a;
    const proposal = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.proposal;
    if (!proposal) {
        return {
            type: null,
            state: null,
            title: null,
            summary: null,
            itemCount: 0,
            previewItems: [],
            safety: null,
        };
    }
    return {
        type: proposal.type,
        state: proposal.state,
        title: proposal.title,
        summary: proposal.summary,
        itemCount: getProposalItemCount(proposal),
        previewItems: getProposalPreviewItems(proposal)
            .slice(0, 3)
            .map((item) => item.title),
        safety: getProposalSafetyProfile(proposal),
    };
}
function buildApplySummary(entry) {
    var _a, _b, _c;
    const actionResult = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.actionResult;
    const proposal = (_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.proposal;
    if (!actionResult) {
        return null;
    }
    return {
        appliedAt: actionResult.appliedAt,
        itemCount: actionResult.itemCount,
        summary: actionResult.summary,
        safety: (_c = actionResult.safety) !== null && _c !== void 0 ? _c : (proposal
            ? Object.assign(Object.assign({}, getProposalSafetyProfile(proposal)), { operatorDecision: "manual_apply", postApplyState: getProposalSafetyProfile(proposal).executionMode === "preview_only"
                    ? "draft_only"
                    : "guarded_execution" }) : {
            level: "medium",
            executionMode: "guarded_patch",
            liveMutation: false,
            mutationSurface: "Unknown legacy action result",
            checks: ["Review the legacy action result manually before downstream publication."],
            compensationMode: "follow_up_patch",
            compensationSummary: "Legacy applied result has no safety metadata. Treat it as a guarded patch and prepare a follow-up correction if needed.",
            compensationSteps: [
                "Inspect the proposal payload and resulting draft artifacts.",
                "Issue a superseding patch if the legacy apply result is unsafe.",
            ],
            operatorDecision: "manual_apply",
            postApplyState: "guarded_execution",
        }),
    };
}
function buildSteps(entry, source, facts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const proposal = (_a = entry.run.result) === null || _a === void 0 ? void 0 : _a.proposal;
    const proposalItemCount = proposal ? getProposalItemCount(proposal) : 0;
    const modelStatus = resolveModelStatus(entry.run.status);
    const proposalStatus = resolveProposalStatus(entry);
    const applyStatus = resolveApplyStatus(entry);
    const collaboration = (_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.collaboration;
    const steps = [
        {
            id: "source",
            label: "Source packet",
            status: "done",
            summary: (() => {
                let summary = `${source.entityType} ${source.entityLabel}`;
                if (source.replayLabel) {
                    summary += ` (${source.replayLabel})`;
                }
                if (source.packetId) {
                    summary += ` from ${source.workflowLabel}`;
                }
                return `${summary}.`;
            })(),
            startedAt: entry.run.createdAt,
            endedAt: entry.run.createdAt,
        },
        {
            id: "facts",
            label: "Facts loaded",
            status: "done",
            summary: `Projects ${facts.projects}, tasks ${facts.tasks}, risks ${facts.risks}, team ${facts.team}, notifications ${facts.notifications}.`,
            startedAt: entry.run.createdAt,
            endedAt: entry.run.createdAt,
        },
        {
            id: "model",
            label: "Model run",
            status: modelStatus,
            summary: modelStatus === "pending"
                ? `Queued in ${entry.origin} mode for ${resolveModelName(entry)}.`
                : modelStatus === "running"
                    ? `Executing ${resolveModelName(entry)} in ${entry.origin} mode.`
                    : modelStatus === "failed"
                        ? (_c = entry.run.errorMessage) !== null && _c !== void 0 ? _c : "Model execution failed."
                        : collaboration
                            ? proposal
                                ? `${resolveModelName(entry)} synthesized a ${collaboration.steps.length}-agent council and returned an approval-gated proposal.`
                                : `${resolveModelName(entry)} synthesized a ${collaboration.steps.length}-agent council and returned a summary.`
                            : proposal
                                ? `${resolveModelName(entry)} returned an approval-gated proposal.`
                                : `${resolveModelName(entry)} returned a summary-only answer.`,
            startedAt: entry.run.createdAt,
            endedAt: modelStatus === "pending" || modelStatus === "running" ? undefined : entry.run.updatedAt,
        },
        ...(collaboration
            ? [
                {
                    id: "council",
                    label: "Multi-agent council",
                    status: "done",
                    summary: `${collaboration.steps.length} specialist perspective(s) led by ${collaboration.leaderAgentId}. Consensus: ${collaboration.consensus.slice(0, 3).join(" · ") || "n/a"}.`,
                    startedAt: entry.run.createdAt,
                    endedAt: entry.run.updatedAt,
                },
            ]
            : []),
        {
            id: "proposal",
            label: "Proposal artifact",
            status: proposalStatus,
            summary: proposal
                ? `${proposal.type} with ${proposalItemCount} item(s) is ${proposal.state}. Safety posture: ${getProposalSafetyProfile(proposal).executionMode}.`
                : proposalStatus === "not_applicable"
                    ? "No approval proposal was generated for this run."
                    : proposalStatus === "failed"
                        ? (_d = entry.run.errorMessage) !== null && _d !== void 0 ? _d : "Proposal generation failed."
                        : "Waiting for proposal output.",
            startedAt: entry.run.createdAt,
            endedAt: proposalStatus === "pending" || proposalStatus === "running" ? undefined : entry.run.updatedAt,
        },
        {
            id: "apply",
            label: "Operator apply",
            status: applyStatus,
            summary: ((_e = entry.run.result) === null || _e === void 0 ? void 0 : _e.actionResult)
                ? `${entry.run.result.actionResult.summary} Compensation: ${entry.run.result.actionResult.safety.compensationSummary}`
                : (proposal === null || proposal === void 0 ? void 0 : proposal.state) === "pending"
                    ? "Waiting for operator approval."
                    : (proposal === null || proposal === void 0 ? void 0 : proposal.state) === "dismissed"
                        ? "Proposal was dismissed and not applied."
                        : "No apply action has been executed.",
            startedAt: (_h = (_g = (_f = entry.run.result) === null || _f === void 0 ? void 0 : _f.actionResult) === null || _g === void 0 ? void 0 : _g.appliedAt) !== null && _h !== void 0 ? _h : entry.run.updatedAt,
            endedAt: (_k = (_j = entry.run.result) === null || _j === void 0 ? void 0 : _j.actionResult) === null || _k === void 0 ? void 0 : _k.appliedAt,
        },
    ];
    return steps;
}
export function buildAIRunTrace(entry) {
    var _a, _b, _c;
    const source = resolveSource(entry);
    const facts = resolveFacts(entry);
    const workflow = source.workflow;
    return {
        runId: entry.run.id,
        workflow,
        title: entry.run.title,
        status: entry.run.status,
        agentId: entry.run.agentId,
        quickActionId: (_a = entry.run.quickActionId) !== null && _a !== void 0 ? _a : null,
        origin: entry.origin,
        model: {
            name: resolveModelName(entry),
            status: resolveModelStatus(entry.run.status),
        },
        source,
        context: {
            type: entry.run.context.type,
            title: entry.run.context.title,
            pathname: entry.run.context.pathname,
            projectId: entry.run.context.projectId,
            facts,
        },
        proposal: buildProposalSummary(entry),
        apply: buildApplySummary(entry),
        collaboration: (_c = (_b = entry.run.result) === null || _b === void 0 ? void 0 : _b.collaboration) !== null && _c !== void 0 ? _c : null,
        promptPreview: trimPrompt(entry.input.prompt),
        createdAt: entry.run.createdAt,
        updatedAt: entry.run.updatedAt,
        steps: buildSteps(entry, source, facts),
        failure: entry.run.errorMessage ? { message: entry.run.errorMessage } : null,
    };
}
export function getServerAIRunTrace(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = yield getServerAIRunEntry(runId);
        return buildAIRunTrace(entry);
    });
}
