function isSameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function compareContext(left, right) {
    var _a, _b;
    return isSameJson({
        workflow: left.workflow,
        promptPreview: left.promptPreview,
        context: {
            type: left.context.type,
            title: left.context.title,
            pathname: left.context.pathname,
            projectId: (_a = left.context.projectId) !== null && _a !== void 0 ? _a : null,
            facts: left.context.facts,
        },
    }, {
        workflow: right.workflow,
        promptPreview: right.promptPreview,
        context: {
            type: right.context.type,
            title: right.context.title,
            pathname: right.context.pathname,
            projectId: (_b = right.context.projectId) !== null && _b !== void 0 ? _b : null,
            facts: right.context.facts,
        },
    });
}
function buildChangedFields(comparison) {
    var _a, _b, _c, _d;
    const fields = [];
    if (!comparison.sameStatus) {
        fields.push(`status ${comparison.originalStatus} -> ${comparison.replayStatus}`);
    }
    if (!comparison.sameModel) {
        fields.push(`model ${comparison.originalModelName} -> ${comparison.replayModelName}`);
    }
    if (!comparison.sameProposalType) {
        fields.push(`proposal ${(_a = comparison.originalProposalType) !== null && _a !== void 0 ? _a : "none"} -> ${(_b = comparison.replayProposalType) !== null && _b !== void 0 ? _b : "none"}`);
    }
    else if (!comparison.sameProposalState) {
        fields.push(`proposal state ${(_c = comparison.originalProposalState) !== null && _c !== void 0 ? _c : "none"} -> ${(_d = comparison.replayProposalState) !== null && _d !== void 0 ? _d : "none"}`);
    }
    if (comparison.itemCountDelta !== 0) {
        fields.push(`proposal items ${comparison.itemCountDelta > 0 ? "+" : ""}${comparison.itemCountDelta}`);
    }
    if (!comparison.sameCollaboration) {
        fields.push(`council size ${comparison.originalCouncilSize} -> ${comparison.replayCouncilSize}`);
    }
    return fields;
}
export function buildAIRunTraceComparison(original, replay) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
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
        sameCollaboration: isSameJson((_b = (_a = original.collaboration) === null || _a === void 0 ? void 0 : _a.consensus) !== null && _b !== void 0 ? _b : [], (_d = (_c = replay.collaboration) === null || _c === void 0 ? void 0 : _c.consensus) !== null && _d !== void 0 ? _d : []) &&
            isSameJson((_f = (_e = original.collaboration) === null || _e === void 0 ? void 0 : _e.supportAgentIds) !== null && _f !== void 0 ? _f : [], (_h = (_g = replay.collaboration) === null || _g === void 0 ? void 0 : _g.supportAgentIds) !== null && _h !== void 0 ? _h : []) &&
            ((_k = (_j = original.collaboration) === null || _j === void 0 ? void 0 : _j.steps.length) !== null && _k !== void 0 ? _k : 0) === ((_m = (_l = replay.collaboration) === null || _l === void 0 ? void 0 : _l.steps.length) !== null && _m !== void 0 ? _m : 0),
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
        originalCouncilSize: (_p = (_o = original.collaboration) === null || _o === void 0 ? void 0 : _o.steps.length) !== null && _p !== void 0 ? _p : 0,
        replayCouncilSize: (_r = (_q = replay.collaboration) === null || _q === void 0 ? void 0 : _q.steps.length) !== null && _r !== void 0 ? _r : 0,
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
