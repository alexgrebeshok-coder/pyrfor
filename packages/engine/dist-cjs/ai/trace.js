"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAIRunTrace = buildAIRunTrace;
exports.getServerAIRunTrace = getServerAIRunTrace;
const action_engine_1 = require("./action-engine");
const server_runs_1 = require("./server-runs");
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
    const source = entry.input.source;
    if (source) {
        return {
            ...source,
            workflowLabel: formatWorkflowLabel(source.workflow),
            purposeLabel: formatPurposeLabel(source.purpose),
            replayLabel: formatReplayLabel(source.replayOfRunId),
        };
    }
    return {
        workflow: "direct_ai_run",
        workflowLabel: "Direct AI run",
        purposeLabel: null,
        replayLabel: null,
        entityType: entry.run.context.type,
        entityId: entry.run.context.projectId ?? entry.run.id,
        entityLabel: entry.run.context.title,
    };
}
function resolveFacts(entry) {
    const ctx = entry.input.context ?? {};
    const currentProjectId = ctx.project?.id ?? ctx.activeContext?.projectId;
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
    const collaborationRuntime = entry.run.result?.collaboration?.leaderRuntime;
    if (collaborationRuntime) {
        return `${collaborationRuntime.provider}/${collaborationRuntime.model}`;
    }
    if (entry.origin === "gateway") {
        return process.env.OPENCLAW_GATEWAY_MODEL?.trim() || "openclaw:main";
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
    if (entry.run.result?.proposal) {
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
    if (entry.run.result?.actionResult) {
        return "done";
    }
    const proposalState = entry.run.result?.proposal?.state;
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
    const proposal = entry.run.result?.proposal;
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
        itemCount: (0, action_engine_1.getProposalItemCount)(proposal),
        previewItems: (0, action_engine_1.getProposalPreviewItems)(proposal)
            .slice(0, 3)
            .map((item) => item.title),
        safety: (0, action_engine_1.getProposalSafetyProfile)(proposal),
    };
}
function buildApplySummary(entry) {
    const actionResult = entry.run.result?.actionResult;
    const proposal = entry.run.result?.proposal;
    if (!actionResult) {
        return null;
    }
    return {
        appliedAt: actionResult.appliedAt,
        itemCount: actionResult.itemCount,
        summary: actionResult.summary,
        safety: actionResult.safety ??
            (proposal
                ? {
                    ...(0, action_engine_1.getProposalSafetyProfile)(proposal),
                    operatorDecision: "manual_apply",
                    postApplyState: (0, action_engine_1.getProposalSafetyProfile)(proposal).executionMode === "preview_only"
                        ? "draft_only"
                        : "guarded_execution",
                }
                : {
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
    const proposal = entry.run.result?.proposal;
    const proposalItemCount = proposal ? (0, action_engine_1.getProposalItemCount)(proposal) : 0;
    const modelStatus = resolveModelStatus(entry.run.status);
    const proposalStatus = resolveProposalStatus(entry);
    const applyStatus = resolveApplyStatus(entry);
    const collaboration = entry.run.result?.collaboration;
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
                        ? entry.run.errorMessage ?? "Model execution failed."
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
                ? `${proposal.type} with ${proposalItemCount} item(s) is ${proposal.state}. Safety posture: ${(0, action_engine_1.getProposalSafetyProfile)(proposal).executionMode}.`
                : proposalStatus === "not_applicable"
                    ? "No approval proposal was generated for this run."
                    : proposalStatus === "failed"
                        ? entry.run.errorMessage ?? "Proposal generation failed."
                        : "Waiting for proposal output.",
            startedAt: entry.run.createdAt,
            endedAt: proposalStatus === "pending" || proposalStatus === "running" ? undefined : entry.run.updatedAt,
        },
        {
            id: "apply",
            label: "Operator apply",
            status: applyStatus,
            summary: entry.run.result?.actionResult
                ? `${entry.run.result.actionResult.summary} Compensation: ${entry.run.result.actionResult.safety.compensationSummary}`
                : proposal?.state === "pending"
                    ? "Waiting for operator approval."
                    : proposal?.state === "dismissed"
                        ? "Proposal was dismissed and not applied."
                        : "No apply action has been executed.",
            startedAt: entry.run.result?.actionResult?.appliedAt ?? entry.run.updatedAt,
            endedAt: entry.run.result?.actionResult?.appliedAt,
        },
    ];
    return steps;
}
function buildAIRunTrace(entry) {
    const source = resolveSource(entry);
    const facts = resolveFacts(entry);
    const workflow = source.workflow;
    return {
        runId: entry.run.id,
        workflow,
        title: entry.run.title,
        status: entry.run.status,
        agentId: entry.run.agentId,
        quickActionId: entry.run.quickActionId ?? null,
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
        collaboration: entry.run.result?.collaboration ?? null,
        promptPreview: trimPrompt(entry.input.prompt),
        createdAt: entry.run.createdAt,
        updatedAt: entry.run.updatedAt,
        steps: buildSteps(entry, source, facts),
        failure: entry.run.errorMessage ? { message: entry.run.errorMessage } : null,
    };
}
async function getServerAIRunTrace(runId) {
    const entry = await (0, server_runs_1.getServerAIRunEntry)(runId);
    return buildAIRunTrace(entry);
}
