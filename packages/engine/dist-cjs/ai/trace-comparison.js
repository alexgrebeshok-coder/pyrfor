"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAIRunTraceComparison = buildAIRunTraceComparison;
function isSameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function compareContext(left, right) {
    return isSameJson({
        workflow: left.workflow,
        promptPreview: left.promptPreview,
        context: {
            type: left.context.type,
            title: left.context.title,
            pathname: left.context.pathname,
            projectId: left.context.projectId ?? null,
            facts: left.context.facts,
        },
    }, {
        workflow: right.workflow,
        promptPreview: right.promptPreview,
        context: {
            type: right.context.type,
            title: right.context.title,
            pathname: right.context.pathname,
            projectId: right.context.projectId ?? null,
            facts: right.context.facts,
        },
    });
}
function buildChangedFields(comparison) {
    const fields = [];
    if (!comparison.sameStatus) {
        fields.push(`status ${comparison.originalStatus} -> ${comparison.replayStatus}`);
    }
    if (!comparison.sameModel) {
        fields.push(`model ${comparison.originalModelName} -> ${comparison.replayModelName}`);
    }
    if (!comparison.sameProposalType) {
        fields.push(`proposal ${comparison.originalProposalType ?? "none"} -> ${comparison.replayProposalType ?? "none"}`);
    }
    else if (!comparison.sameProposalState) {
        fields.push(`proposal state ${comparison.originalProposalState ?? "none"} -> ${comparison.replayProposalState ?? "none"}`);
    }
    if (comparison.itemCountDelta !== 0) {
        fields.push(`proposal items ${comparison.itemCountDelta > 0 ? "+" : ""}${comparison.itemCountDelta}`);
    }
    if (!comparison.sameCollaboration) {
        fields.push(`council size ${comparison.originalCouncilSize} -> ${comparison.replayCouncilSize}`);
    }
    return fields;
}
function buildAIRunTraceComparison(original, replay) {
    const comparison = {
        originalRunId: original.runId,
        replayRunId: replay.runId,
        sameWorkflow: original.workflow === replay.workflow,
        samePrompt: original.promptPreview === replay.promptPreview,
        sameContext: compareContext(original, replay),
        sameModel: original.model.name === replay.model.name,
        sameStatus: original.status === replay.status,
        sameProposalType: original.proposal.type === replay.proposal.type,
        sameProposalState: original.proposal.state === replay.proposal.state,
        sameCollaboration: isSameJson(original.collaboration?.consensus ?? [], replay.collaboration?.consensus ?? []) &&
            isSameJson(original.collaboration?.supportAgentIds ?? [], replay.collaboration?.supportAgentIds ?? []) &&
            (original.collaboration?.steps.length ?? 0) === (replay.collaboration?.steps.length ?? 0),
        originalModelName: original.model.name,
        replayModelName: replay.model.name,
        originalStatus: original.status,
        replayStatus: replay.status,
        originalProposalType: original.proposal.type,
        replayProposalType: replay.proposal.type,
        originalProposalState: original.proposal.state,
        replayProposalState: replay.proposal.state,
        originalProposalItemCount: original.proposal.itemCount,
        replayProposalItemCount: replay.proposal.itemCount,
        originalCouncilSize: original.collaboration?.steps.length ?? 0,
        replayCouncilSize: replay.collaboration?.steps.length ?? 0,
        itemCountDelta: replay.proposal.itemCount - original.proposal.itemCount,
        changedFields: [],
        summary: "",
    };
    comparison.changedFields = buildChangedFields(comparison);
    comparison.summary = comparison.changedFields.length
        ? `Replay changed ${comparison.changedFields.length} field${comparison.changedFields.length === 1 ? "" : "s"}: ${comparison.changedFields.slice(0, 3).join(" · ")}`
        : `Replay matched the original run ${comparison.originalRunId}.`;
    return comparison;
}
