var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function createAlgorithmAwareRetriever(memoryStore) {
    return {
        retrieve(req) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d;
                const tags = [
                    ...req.algorithms,
                    ...((_a = req.phases) !== null && _a !== void 0 ? _a : []),
                    ...((_b = req.nodeKinds) !== null && _b !== void 0 ? _b : []),
                    ...((_c = req.ruleKeys) !== null && _c !== void 0 ? _c : []),
                    ...((_d = req.statuses) !== null && _d !== void 0 ? _d : []),
                    ...(req.projectId ? [`project:${req.projectId}`] : []),
                ];
                const entries = memoryStore.query({
                    kind: 'lesson',
                    tags: tags.length > 0 ? tags : undefined,
                    limit: Math.max(req.limit * 3, req.limit),
                });
                return entries
                    .map((entry) => {
                    const applicabilityScore = scoreApplicability(entry.tags, tags);
                    const observedImpactScore = clamp(entry.weight);
                    const confidenceScore = entry.tags.includes('confidence:high') ? 1 : entry.tags.includes('confidence:medium') ? 0.66 : 0.33;
                    const recencyScore = recency(entry.updated_at);
                    return {
                        id: entry.id,
                        providerId: 'algorithm-aware-retriever',
                        priority: applicabilityScore * 100 + observedImpactScore * 20 + confidenceScore * 10 + recencyScore,
                        content: entry.text,
                        sourceRefs: [entry.source],
                        algorithm: req.algorithms[0],
                        tags: entry.tags,
                        applicabilityScore,
                        observedImpactScore,
                        confidenceScore,
                        recencyScore,
                    };
                })
                    .filter((item) => { var _a; return !((_a = req.kinds) === null || _a === void 0 ? void 0 : _a.length) || hasAnyTag(item.tags, req.kinds); })
                    .filter((item) => !req.excludeLegacy || isPlannerVisible(item.tags, req.projectId))
                    .filter((item) => item.applicabilityScore > 0 || tags.length === 0)
                    .sort((a, b) => b.priority - a.priority)
                    .slice(0, req.limit);
            });
        },
    };
}
function hasAnyTag(itemTags, tags) {
    return tags.some((tag) => itemTags.includes(tag));
}
function isPlannerVisible(tags, projectId) {
    if (hasAnyTag(tags, ['legacy', 'rejected', 'quarantined', 'imported_quarantined']))
        return false;
    if (hasAnyTag(tags, ['approvalState:rejected', 'approvalState:quarantined']))
        return false;
    return projectId === undefined || tags.includes(`project:${projectId}`);
}
function scoreApplicability(entryTags, requiredTags) {
    if (requiredTags.length === 0)
        return 1;
    let hits = 0;
    for (const tag of requiredTags) {
        if (entryTags.includes(tag))
            hits += 1;
    }
    return hits / requiredTags.length;
}
function recency(updatedAt) {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs <= 0)
        return 1;
    const dayMs = 24 * 60 * 60 * 1000;
    return clamp(1 / (1 + ageMs / (30 * dayMs)));
}
function clamp(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
