export const DEFAULT_UNIVERSAL_ENGINE_EVAL_CASES = [
    {
        id: 'universal-engine.lifecycle',
        criteria: [
            {
                kind: 'required_event_sequence',
                params: {
                    sequence: [
                        'concept.started',
                        'dag.node.completed',
                        'test.completed',
                        'delivery.completed',
                        'postmortem.completed',
                    ],
                },
            },
            { kind: 'terminal_concept_event' },
        ],
    },
    {
        id: 'universal-engine.delivery-artifacts',
        criteria: [
            { kind: 'no_artifact_uri_leak' },
            { kind: 'delivery_artifacts_have_hashes' },
        ],
    },
    {
        id: 'universal-engine.self-improvement-gates',
        criteria: [
            { kind: 'human_tier_self_improvement' },
            { kind: 'promotions_have_eval_proof' },
        ],
    },
];
export function runUniversalEngineEvals(trace, cases = DEFAULT_UNIVERSAL_ENGINE_EVAL_CASES) {
    const scores = cases.map((evalCase) => scoreCase(evalCase, trace));
    const passedCases = scores.filter((score) => score.passed).length;
    return {
        totalCases: cases.length,
        passedCases,
        averageRatio: scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score.ratio, 0) / scores.length,
        scores,
    };
}
export function scoreUniversalEngineCriterion(criterion, trace) {
    var _a, _b;
    const weight = (_a = criterion.weight) !== null && _a !== void 0 ? _a : 1;
    const pass = (reason) => ({
        criterion,
        passed: true,
        score: weight,
        reason,
    });
    const fail = (reason) => ({
        criterion,
        passed: false,
        score: 0,
        reason,
    });
    switch (criterion.kind) {
        case 'required_event_sequence': {
            const sequence = stringArrayParam(criterion, 'sequence');
            const eventTypes = trace.events.map((event) => event.type);
            let cursor = 0;
            for (const type of eventTypes) {
                if (type === sequence[cursor])
                    cursor += 1;
                if (cursor === sequence.length)
                    return pass(`observed event sequence: ${sequence.join(' -> ')}`);
            }
            return fail(`missing ordered event sequence: ${sequence.slice(cursor).join(' -> ')}`);
        }
        case 'terminal_concept_event': {
            const terminalIndex = trace.events.findIndex((event) => event.type === 'concept.completed' ||
                event.type === 'run.failed' ||
                event.type === 'run.cancelled');
            if (terminalIndex === -1)
                return fail('no terminal concept/run event present');
            if (terminalIndex !== trace.events.length - 1) {
                return fail(`terminal event ${(_b = trace.events[terminalIndex]) === null || _b === void 0 ? void 0 : _b.type} was followed by later events`);
            }
            return pass(`terminal event closes trace: ${trace.events[terminalIndex].type}`);
        }
        case 'no_artifact_uri_leak': {
            const leaked = trace.artifactRefs.filter((ref) => typeof ref.uri === 'string' && ref.uri.length > 0);
            return leaked.length === 0
                ? pass('artifact references are URI-sanitized')
                : fail(`artifact URI leaked for refs: ${leaked.map((ref) => ref.id).join(', ')}`);
        }
        case 'delivery_artifacts_have_hashes': {
            const requiredKinds = ['artifact_manifest', 'delivery_bundle', 'postmortem_report'];
            const missingKinds = requiredKinds.filter((kind) => !trace.artifactRefs.some((ref) => ref.kind === kind));
            if (missingKinds.length > 0)
                return fail(`delivery artifacts missing: ${missingKinds.join(', ')}`);
            const missingHashes = trace.artifactRefs.filter((ref) => requiredKinds.includes(ref.kind) && !ref.sha256);
            return missingHashes.length === 0
                ? pass('delivery/postmortem artifacts are present and carry sha256')
                : fail(`delivery artifacts missing sha256: ${missingHashes.map((ref) => ref.id).join(', ')}`);
        }
        case 'human_tier_self_improvement': {
            const illegal = trace.events.filter((event) => event.type === 'self_improvement.proposal.promoted' &&
                event.proposal_type !== undefined &&
                ['policy', 'budget', 'verifier_rules'].includes(event.proposal_type));
            return illegal.length === 0
                ? pass('policy/budget/verifier self-improvements were not auto-promoted')
                : fail(`human-tier self-improvement auto-promoted ${illegal.length} time(s)`);
        }
        case 'promotions_have_eval_proof': {
            const promoted = trace.events.filter((event) => event.type === 'self_improvement.proposal.promoted');
            const invalidProof = promoted.filter((event) => !hasValidPromotionProof(event, trace));
            return invalidProof.length === 0
                ? pass('all promoted self-improvements reference evaluated test_result proof')
                : fail(`promotions missing valid eval proof: ${invalidProof.length}`);
        }
    }
}
function scoreCase(evalCase, trace) {
    const criterionScores = evalCase.criteria.map((criterion) => scoreUniversalEngineCriterion(criterion, trace));
    const totalScore = criterionScores.reduce((sum, score) => sum + score.score, 0);
    const maxScore = evalCase.criteria.reduce((sum, criterion) => { var _a; return sum + ((_a = criterion.weight) !== null && _a !== void 0 ? _a : 1); }, 0);
    const ratio = maxScore === 0 ? 1 : totalScore / maxScore;
    return {
        caseId: evalCase.id,
        totalScore,
        maxScore,
        ratio,
        passed: ratio === 1,
        criterionScores,
    };
}
function stringArrayParam(criterion, key) {
    var _a;
    const value = (_a = criterion.params) === null || _a === void 0 ? void 0 : _a[key];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function hasValidPromotionProof(event, trace) {
    const promoted = event;
    if (!promoted.entry_id || !promoted.artifact_id)
        return false;
    const proofRef = trace.artifactRefs.find((ref) => ref.id === promoted.artifact_id);
    if (!proofRef || proofRef.kind !== 'test_result' || !proofRef.sha256)
        return false;
    const promotedIndex = trace.events.indexOf(event);
    if (promotedIndex <= 0)
        return false;
    return trace.events.slice(0, promotedIndex).some((candidate) => {
        if (candidate.type !== 'self_improvement.proposal.evaluated')
            return false;
        const evaluated = candidate;
        return (evaluated.entry_id === promoted.entry_id &&
            evaluated.artifact_id === promoted.artifact_id &&
            evaluated.eval_verdict === 'pass');
    });
}
