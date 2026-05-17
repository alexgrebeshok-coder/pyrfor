var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class PostMortemError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PostMortemError';
    }
}
export function buildPostMortem(input, clock = Date.now) {
    var _a, _b, _c, _d, _e, _f, _g;
    validatePostMortemInput(input);
    const record = input.conceptRecord;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ schemaVersion: 'pyrfor.postmortem.v1', runId: record.runId, conceptId: record.conceptId }, (record.projectId ? { projectId: record.projectId } : {})), (record.parentConceptId ? { parentConceptId: record.parentConceptId } : {})), (record.retryOf ? { retryOf: record.retryOf } : {})), { goal: record.goal, outcome: input.outcome, summary: input.summary, whatWorked: (_a = input.whatWorked) !== null && _a !== void 0 ? _a : [], whatFailed: (_b = input.whatFailed) !== null && _b !== void 0 ? _b : (record.error ? [record.error] : []), toolsUsed: (_c = input.toolsUsed) !== null && _c !== void 0 ? _c : [], toolsForged: (_d = input.toolsForged) !== null && _d !== void 0 ? _d : [], verifierFindings: (_e = input.verifierFindings) !== null && _e !== void 0 ? _e : [], reusablePatterns: (_f = input.reusablePatterns) !== null && _f !== void 0 ? _f : [], memoryWriteRecommendations: (_g = input.memoryWriteRecommendations) !== null && _g !== void 0 ? _g : [], createdAt: new Date(clock()).toISOString(), phaseArtifactRefs: record.artifactRefs.map((ref) => ref.id) }), (input.deliveryBundleRef ? { deliveryBundleRef: input.deliveryBundleRef } : {})), (record.error ? { error: record.error } : {}));
}
export function runPostMortem(input, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        validatePostMortemInput(input);
        const record = input.conceptRecord;
        yield deps.ledger.append({
            type: 'postmortem.started',
            run_id: record.runId,
            concept_id: record.conceptId,
        });
        const postmortem = buildPostMortem(input, deps.clock);
        const artifactRef = yield deps.artifactStore.writeJSON('postmortem_report', postmortem, {
            runId: record.runId,
            meta: Object.assign({ conceptId: record.conceptId, outcome: input.outcome }, (input.deliveryBundleRef ? { deliveryBundleRef: input.deliveryBundleRef } : {})),
        });
        yield deps.ledger.append({
            type: 'postmortem.completed',
            run_id: record.runId,
            concept_id: record.conceptId,
            artifact_id: artifactRef.id,
            status: input.outcome,
        });
        return artifactRef;
    });
}
function validatePostMortemInput(input) {
    if (!input.conceptRecord.conceptId.trim())
        throw new PostMortemError('conceptId is required');
    if (!input.conceptRecord.runId.trim())
        throw new PostMortemError('runId is required');
    if (!input.summary.trim())
        throw new PostMortemError('summary is required');
}
