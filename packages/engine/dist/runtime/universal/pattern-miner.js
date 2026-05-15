var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash, randomUUID } from 'node:crypto';
export class PatternMinerValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PatternMinerValidationError';
    }
}
export function splitExperienceHoldout(entries, holdoutRatio = 0.2) {
    const ratio = Math.min(Math.max(holdoutRatio, 0), 0.5);
    const sorted = [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (sorted.length < 2 || ratio === 0)
        return { training: sorted, holdout: [] };
    const holdoutCount = Math.max(1, Math.ceil(sorted.length * ratio));
    return {
        training: sorted.slice(0, -holdoutCount),
        holdout: sorted.slice(-holdoutCount),
    };
}
export class PatternMiner {
    constructor(deps) {
        this.deps = deps;
    }
    run(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            validateInput(input);
            const budgetCheck = (_a = this.deps.budgetController) === null || _a === void 0 ? void 0 : _a.canConsume({
                scope: 'self_improvement',
                targetId: input.runId,
                phaseId: 'pattern_mining',
                algorithm: 'system_self_improvement',
                toolName: 'pattern_miner',
                estPromptTokens: (_b = input.estimatedTokens) !== null && _b !== void 0 ? _b : 0,
                estCompletionTokens: 0,
                estCostUsd: (_c = input.estimatedCostUsd) !== null && _c !== void 0 ? _c : 0,
            });
            if (budgetCheck && !budgetCheck.allowed) {
                return emptyResult(true);
            }
            const entries = yield this.deps.experienceLibrary.queryForPlanner({
                projectId: input.projectId,
                domain: input.domain,
                outcome: 'completed',
                limit: (_d = input.maxExperienceEntries) !== null && _d !== void 0 ? _d : 200,
            });
            const { training, holdout } = splitExperienceHoldout(entries, (_e = input.holdoutRatio) !== null && _e !== void 0 ? _e : 0.2);
            const candidates = mineSuccessPatterns(training, holdout, {
                minTrainingSupport: (_f = input.minTrainingSupport) !== null && _f !== void 0 ? _f : 2,
                minHoldoutSupport: (_g = input.minHoldoutSupport) !== null && _g !== void 0 ? _g : 1,
                maxProposals: (_h = input.maxProposals) !== null && _h !== void 0 ? _h : 5,
            });
            const result = {
                scanned: entries.length,
                trainingCount: training.length,
                holdoutCount: holdout.length,
                candidates,
                candidateEntryIds: [],
                proposalArtifactIds: [],
                budgetBlocked: false,
            };
            for (const candidate of candidates) {
                const written = yield this.writeCandidate(input, candidate, training, holdout);
                if (!written)
                    continue;
                result.candidateEntryIds.push(written.entryId);
                result.proposalArtifactIds.push(written.proposalRef.id);
            }
            if (this.deps.budgetController && (((_j = input.estimatedTokens) !== null && _j !== void 0 ? _j : 0) > 0 || ((_k = input.estimatedCostUsd) !== null && _k !== void 0 ? _k : 0) > 0)) {
                this.deps.budgetController.recordConsumption({
                    ts: this.nowMs(),
                    scope: 'self_improvement',
                    targetId: input.runId,
                    phaseId: 'pattern_mining',
                    algorithm: 'system_self_improvement',
                    toolName: 'pattern_miner',
                    promptTokens: (_l = input.estimatedTokens) !== null && _l !== void 0 ? _l : 0,
                    completionTokens: 0,
                    costUsd: (_m = input.estimatedCostUsd) !== null && _m !== void 0 ? _m : 0,
                });
            }
            return result;
        });
    }
    writeCandidate(input, candidate, training, holdout) {
        return __awaiter(this, void 0, void 0, function* () {
            const similarityKey = `success-pattern:${input.projectId}:${stableSlug(candidate.patternKey)}`;
            if (this.hasExistingCandidate(similarityKey))
                return undefined;
            const reportRef = yield this.deps.artifactStore.writeJSON('summary', {
                schemaVersion: 'pyrfor.pattern_miner_report.v1',
                algorithm: 'success_extraction',
                projectId: input.projectId,
                domain: input.domain,
                candidate,
                trainingEntryIds: training.map((entry) => entry.id),
                holdoutEntryIds: holdout.map((entry) => entry.id),
                generatedAt: this.nowIso(),
            }, {
                runId: input.runId,
                meta: {
                    conceptId: input.conceptId,
                    patternKey: candidate.patternKey,
                },
            });
            const record = this.doubleLoopRecord(input, candidate, similarityKey, reportRef.id);
            const entry = this.deps.memoryStore.add({
                kind: 'lesson',
                text: JSON.stringify(record),
                source: `pattern-miner:${input.runId}`,
                scope: 'universal',
                tags: [
                    'double_loop',
                    'candidate',
                    'self_improvement',
                    'pattern_miner',
                    'approvalState:pending_approval',
                    'non_legacy',
                    'non_quarantined',
                    `project:${input.projectId}`,
                    `ruleKey:${record.targetScope.ruleKey}`,
                ],
                weight: Math.min(1, 0.5 + candidate.averageVerifierScore / 2),
            });
            const proposal = {
                schemaVersion: 'pyrfor.improvement_proposal.v1',
                entryId: entry.id,
                record,
                rollbackVerified: false,
                decision: 'pending',
                decisionReason: 'pattern_miner_candidate_requires_meta_critic',
                evaluatedAt: this.nowIso(),
            };
            const proposalRef = yield this.deps.artifactStore.writeJSON('improvement_proposal', proposal, {
                runId: input.runId,
                meta: {
                    conceptId: input.conceptId,
                    entryId: entry.id,
                    decision: proposal.decision,
                    source: 'pattern_miner',
                },
            });
            return { entryId: entry.id, proposalRef };
        });
    }
    doubleLoopRecord(input, candidate, similarityKey, reportArtifactId) {
        var _a;
        const now = this.nowIso();
        const ruleKey = `system_self_improvement.success_pattern.${stableSlug(candidate.patternKey)}`;
        return {
            id: randomUUID(),
            kind: 'double_loop',
            provenance: 'native',
            confidence: candidate.holdoutSupport >= 2 ? 'high' : 'medium',
            context: {
                runId: input.runId,
                conceptId: input.conceptId,
                projectId: input.projectId,
                nodeId: 'pattern-miner',
                nodeHash: hashValue({ input, candidate }),
                algorithm: 'system_self_improvement',
                phase: 'self_improvement',
                nodeKind: 'consequential',
                domain: (_a = candidate.domain) !== null && _a !== void 0 ? _a : input.domain,
                toolSignatures: candidate.toolSignatures,
                verifierScore: candidate.averageVerifierScore,
                acceptanceTestPassRate: candidate.averageAcceptancePassRate,
            },
            sourceLessonsArtifactRef: reportArtifactId,
            sourceRunId: input.runId,
            artifactIds: [reportArtifactId],
            approvalState: 'pending_approval',
            legacy: false,
            quarantined: false,
            evidence: [{ artifactRef: reportArtifactId, verifierConfirmed: true }],
            createdAt: now,
            author: 'agent:pattern_miner',
            proposedChangeType: 'heuristic',
            targetScope: {
                algorithm: 'strategic_planning',
                phase: 'plan',
                nodeKind: 'consequential',
                ruleKey,
                currentRule: 'No mined success-pattern heuristic is installed for this project scope.',
                proposedRule: `When project/domain context matches, inject the approved planning heuristic: ${candidate.patternKey}`,
            },
            systemicDefect: 'Repeated successful experience pattern is not yet represented as a reusable planning heuristic.',
            expectedImpact: `Increase planner reuse of a pattern seen ${candidate.support} times in training and ${candidate.holdoutSupport} times in holdout.`,
            impact: {
                predictedScore: candidate.averageVerifierScore,
                observedScore: candidate.averageVerifierScore,
                successRateDelta: candidate.holdoutSupport / Math.max(1, candidate.support + candidate.holdoutSupport),
                verifierPassRateDelta: candidate.averageAcceptancePassRate,
                riskDelta: 'same',
            },
            risks: ['pattern may be overfit to recent project-local successes'],
            rollbackPlan: `Reject or quarantine rule ${ruleKey}; planner falls back to approved MemoryStore retrieval without this heuristic.`,
            status: 'candidate',
            similarityKey,
            requiresNovelEvidenceAfterRejection: true,
        };
    }
    hasExistingCandidate(similarityKey) {
        return this.deps.memoryStore.query({ kind: 'lesson', tags: ['double_loop'], limit: 1000 })
            .some((entry) => {
            let parsed;
            try {
                parsed = JSON.parse(entry.text);
            }
            catch (error) {
                if (error instanceof SyntaxError)
                    return false;
                throw error;
            }
            return parsed.similarityKey === similarityKey && parsed.status !== 'rejected' && parsed.status !== 'quarantined';
        });
    }
    nowMs() {
        var _a;
        return ((_a = this.deps.clock) !== null && _a !== void 0 ? _a : Date.now)();
    }
    nowIso() {
        return new Date(this.nowMs()).toISOString();
    }
}
function mineSuccessPatterns(training, holdout, options) {
    var _a;
    const groups = new Map();
    for (const entry of training) {
        for (const patternKey of entry.reusablePatterns.map(normalizePattern).filter(Boolean)) {
            const group = (_a = groups.get(patternKey)) !== null && _a !== void 0 ? _a : { patternKey, training: [], holdout: [] };
            group.training.push(entry);
            groups.set(patternKey, group);
        }
    }
    for (const entry of holdout) {
        for (const patternKey of entry.reusablePatterns.map(normalizePattern).filter(Boolean)) {
            const group = groups.get(patternKey);
            if (group)
                group.holdout.push(entry);
        }
    }
    return [...groups.values()]
        .filter((group) => group.training.length >= options.minTrainingSupport)
        .filter((group) => group.holdout.length >= options.minHoldoutSupport)
        .map((group) => toCandidate(group.patternKey, group.training, group.holdout))
        .sort((a, b) => (b.holdoutSupport + b.averageVerifierScore) - (a.holdoutSupport + a.averageVerifierScore))
        .slice(0, options.maxProposals);
}
function toCandidate(patternKey, training, holdout) {
    var _a;
    const all = [...training, ...holdout];
    return {
        patternKey,
        support: training.length,
        holdoutSupport: holdout.length,
        evidenceEntryIds: training.map((entry) => entry.id),
        holdoutEntryIds: holdout.map((entry) => entry.id),
        averageVerifierScore: average(all.map((entry) => { var _a, _b; return (_b = (_a = entry.verifierScore) !== null && _a !== void 0 ? _a : entry.patternEffectiveness) !== null && _b !== void 0 ? _b : 0.5; })),
        averageAcceptancePassRate: average(all.map((entry) => { var _a; return (_a = entry.acceptanceTestPassRate) !== null && _a !== void 0 ? _a : 0.5; })),
        toolSignatures: uniqueStrings(all.flatMap((entry) => entry.retrievalKey.toolSignatures)),
        domain: (_a = all.find((entry) => entry.domain)) === null || _a === void 0 ? void 0 : _a.domain,
    };
}
function validateInput(input) {
    if (!input.runId.trim())
        throw new PatternMinerValidationError('runId is required');
    if (!input.conceptId.trim())
        throw new PatternMinerValidationError('conceptId is required');
    if (input.conceptKind !== 'meta.improvement') {
        throw new PatternMinerValidationError('PatternMiner must run as a meta.improvement concept');
    }
    if (!input.projectId.trim() || input.projectId === '*') {
        throw new PatternMinerValidationError('projectId is required and cannot be wildcard');
    }
}
function normalizePattern(pattern) {
    return pattern.trim().replace(/\s+/g, ' ');
}
function stableSlug(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
function hashValue(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}
function average(values) {
    if (values.length === 0)
        return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}
function emptyResult(budgetBlocked) {
    return {
        scanned: 0,
        trainingCount: 0,
        holdoutCount: 0,
        candidates: [],
        candidateEntryIds: [],
        proposalArtifactIds: [],
        budgetBlocked,
    };
}
