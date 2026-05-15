var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function createExperienceLibrary(options) {
    var _a;
    const now = (_a = options.now) !== null && _a !== void 0 ? _a : (() => new Date());
    function query(q) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (q.retrievalBackend !== undefined &&
                q.retrievalBackend !== 'fts' &&
                q.retrievalBackend !== 'embedding') {
                throw new ExperienceLibraryError(`unsupported retrieval backend: ${q.retrievalBackend}`);
            }
            const limit = (_a = q.limit) !== null && _a !== void 0 ? _a : 5;
            const candidateLimit = Math.max(limit * 5, limit);
            if (q.retrievalBackend === 'embedding') {
                return queryByEmbedding(q, limit, candidateLimit);
            }
            return queryByFts(q, limit, candidateLimit);
        });
    }
    function queryForPlanner(q) {
        return __awaiter(this, void 0, void 0, function* () {
            return query(Object.assign(Object.assign({}, q), { audience: 'planner' }));
        });
    }
    function findSimilar(q) {
        return __awaiter(this, void 0, void 0, function* () {
            return queryForPlanner({ goal: q.goal, projectId: q.projectId, limit: q.limit });
        });
    }
    function getPatternEffectiveness(patternKey) {
        return __awaiter(this, void 0, void 0, function* () {
            const entries = yield query({ projectId: '*', audience: 'audit', limit: 500 });
            const matches = entries.filter((entry) => entry.reusablePatterns.includes(patternKey));
            if (matches.length === 0)
                return 0;
            const total = matches.reduce((sum, entry) => { var _a, _b; return sum + ((_b = (_a = entry.patternEffectiveness) !== null && _a !== void 0 ? _a : entry.verifierScore) !== null && _b !== void 0 ? _b : 0); }, 0);
            return Number((total / matches.length).toFixed(3));
        });
    }
    function getTopPatterns(domain, limit) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const entries = yield query({ projectId: '*', audience: 'audit', domain, limit: 500 });
            const stats = new Map();
            for (const entry of entries) {
                for (const pattern of entry.reusablePatterns) {
                    const stat = (_a = stats.get(pattern)) !== null && _a !== void 0 ? _a : { values: [], ids: [] };
                    stat.values.push((_c = (_b = entry.patternEffectiveness) !== null && _b !== void 0 ? _b : entry.verifierScore) !== null && _c !== void 0 ? _c : 0);
                    stat.ids.push(entry.id);
                    stats.set(pattern, stat);
                }
            }
            return [...stats.entries()]
                .map(([patternKey, stat]) => ({
                patternKey,
                occurrences: stat.ids.length,
                averageEffectiveness: Number((stat.values.reduce((sum, value) => sum + value, 0) / stat.values.length).toFixed(3)),
                evidenceEntryIds: stat.ids,
            }))
                .sort((a, b) => b.occurrences - a.occurrences || b.averageEffectiveness - a.averageEffectiveness)
                .slice(0, limit);
        });
    }
    return { query, queryForPlanner, findSimilar, getPatternEffectiveness, getTopPatterns };
    function ftsOrTagQuery(q, candidateLimit) {
        const searched = options.memoryStore.search(q.goal, { limit: candidateLimit });
        const tagged = options.memoryStore.query({
            kind: ['lesson', 'strategy'],
            tags: queryTags(q),
            limit: candidateLimit,
        });
        return dedupeMemoryEntries([...searched, ...tagged]);
    }
    function queryByFts(q, limit, candidateLimit) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const candidates = ((_a = q.goal) === null || _a === void 0 ? void 0 : _a.trim())
                ? ftsOrTagQuery(q, candidateLimit)
                : taggedQuery(q, candidateLimit);
            const entries = yield projectCandidates(candidates);
            return entries
                .filter((entry) => matchesQuery(entry, q))
                .sort((a, b) => scoreEntry(b, q) - scoreEntry(a, q))
                .slice(0, limit);
        });
    }
    function queryByEmbedding(q, limit, candidateLimit) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const embedder = (_a = options.embeddings) === null || _a === void 0 ? void 0 : _a.embedder;
            if (((_b = options.embeddings) === null || _b === void 0 ? void 0 : _b.enabled) !== true || embedder === undefined || !((_c = q.goal) === null || _c === void 0 ? void 0 : _c.trim())) {
                (_e = (_d = options.embeddings) === null || _d === void 0 ? void 0 : _d.onFallback) === null || _e === void 0 ? void 0 : _e.call(_d, 'embedding_disabled_or_unavailable');
                return queryByFts(Object.assign(Object.assign({}, q), { retrievalBackend: 'fts' }), limit, candidateLimit);
            }
            try {
                const candidates = taggedQuery(q, Math.max(candidateLimit * 4, 50));
                const entries = (yield projectCandidates(candidates)).filter((entry) => matchesQuery(entry, q));
                if (entries.length === 0)
                    return [];
                const vectors = yield Promise.resolve(embedder([q.goal, ...entries.map((entry) => entry.retrievalKey.fts)]));
                const [queryVector, ...entryVectors] = vectors;
                if (queryVector === undefined || entryVectors.length !== entries.length) {
                    throw new ExperienceLibraryError('embedding backend returned an invalid vector count');
                }
                const scored = entries
                    .map((entry, index) => {
                    const vector = entryVectors[index];
                    if (vector === undefined)
                        throw new ExperienceLibraryError('embedding backend returned a missing vector');
                    return {
                        entry,
                        score: cosineSimilarity(queryVector, vector),
                    };
                })
                    .filter(({ score }) => { var _a, _b; return score >= ((_b = (_a = options.embeddings) === null || _a === void 0 ? void 0 : _a.minScore) !== null && _b !== void 0 ? _b : Number.NEGATIVE_INFINITY); })
                    .sort((a, b) => b.score - a.score || scoreEntry(b.entry, q) - scoreEntry(a.entry, q))
                    .map(({ entry }) => entry);
                return scored.slice(0, limit);
            }
            catch (error) {
                (_g = (_f = options.embeddings) === null || _f === void 0 ? void 0 : _f.onFallback) === null || _g === void 0 ? void 0 : _g.call(_f, 'embedding_query_failed', error);
                return queryByFts(Object.assign(Object.assign({}, q), { retrievalBackend: 'fts' }), limit, candidateLimit);
            }
        });
    }
    function taggedQuery(q, candidateLimit) {
        return options.memoryStore.query({
            kind: ['lesson', 'strategy'],
            tags: queryTags(q),
            limit: candidateLimit,
        });
    }
    function projectCandidates(candidates) {
        return __awaiter(this, void 0, void 0, function* () {
            const entries = yield Promise.all(candidates.map((entry) => projectMemoryEntry(entry, options.artifactStore, now())));
            return entries.filter((entry) => entry !== undefined);
        });
    }
}
export class ExperienceLibraryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ExperienceLibraryError';
    }
}
function projectMemoryEntry(entry, artifactStore, indexedAt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17;
        if (entry.kind !== 'lesson' && entry.kind !== 'strategy')
            return undefined;
        const parsed = parseLessonRecord(entry);
        const projectId = (_a = tagValue(entry.tags, 'project:')) !== null && _a !== void 0 ? _a : (_b = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _b === void 0 ? void 0 : _b.projectId;
        if (!projectId)
            return undefined;
        const artifactIds = uniqueStrings([
            ...tagValues(entry.tags, 'artifactId:'),
            ...tagValues(entry.tags, 'artifactRef:'),
            ...((_c = parsed === null || parsed === void 0 ? void 0 : parsed.artifactIds) !== null && _c !== void 0 ? _c : []),
        ]);
        const sourceArtifacts = artifactStore
            ? yield resolveIndexedArtifacts(artifactStore, artifactIds)
            : [];
        const postmortem = artifactStore
            ? yield readFirstPostmortem(artifactStore, sourceArtifacts)
            : undefined;
        const approvalState = normalizeApprovalState((_d = tagValue(entry.tags, 'approvalState:')) !== null && _d !== void 0 ? _d : parsed === null || parsed === void 0 ? void 0 : parsed.approvalState);
        const legacy = entry.tags.includes('legacy') || (parsed === null || parsed === void 0 ? void 0 : parsed.legacy) === true;
        const quarantined = entry.tags.includes('quarantined') || entry.tags.includes('imported_quarantined') || (parsed === null || parsed === void 0 ? void 0 : parsed.quarantined) === true;
        const domain = (_e = tagValue(entry.tags, 'domain:')) !== null && _e !== void 0 ? _e : (_f = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _f === void 0 ? void 0 : _f.domain;
        const toolSignatures = uniqueStrings([
            ...tagValues(entry.tags, 'toolSignature:'),
            ...((_h = (_g = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _g === void 0 ? void 0 : _g.toolSignatures) !== null && _h !== void 0 ? _h : []),
            ...((_j = postmortem === null || postmortem === void 0 ? void 0 : postmortem.toolsUsed) !== null && _j !== void 0 ? _j : []),
            ...((_k = postmortem === null || postmortem === void 0 ? void 0 : postmortem.toolsForged) !== null && _k !== void 0 ? _k : []),
        ]);
        const runId = (_p = (_o = (_l = tagValue(entry.tags, 'runId:')) !== null && _l !== void 0 ? _l : (_m = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _m === void 0 ? void 0 : _m.runId) !== null && _o !== void 0 ? _o : parsed === null || parsed === void 0 ? void 0 : parsed.sourceRunId) !== null && _p !== void 0 ? _p : 'unknown';
        const conceptId = (_q = tagValue(entry.tags, 'conceptId:')) !== null && _q !== void 0 ? _q : (_r = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _r === void 0 ? void 0 : _r.conceptId;
        const verifierScore = (_s = numberFromTag(entry.tags, 'verifierScore:')) !== null && _s !== void 0 ? _s : (_t = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _t === void 0 ? void 0 : _t.verifierScore;
        const acceptanceTestPassRate = (_u = numberFromTag(entry.tags, 'acceptanceTestPassRate:')) !== null && _u !== void 0 ? _u : (_v = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _v === void 0 ? void 0 : _v.acceptanceTestPassRate;
        const whatWorked = ((_w = postmortem === null || postmortem === void 0 ? void 0 : postmortem.whatWorked) === null || _w === void 0 ? void 0 : _w.length)
            ? postmortem.whatWorked
            : (parsed === null || parsed === void 0 ? void 0 : parsed.fixApplied) ? [parsed.fixApplied] : [entry.text];
        const whatFailed = ((_x = postmortem === null || postmortem === void 0 ? void 0 : postmortem.whatFailed) === null || _x === void 0 ? void 0 : _x.length)
            ? postmortem.whatFailed
            : uniqueStrings([(_y = parsed === null || parsed === void 0 ? void 0 : parsed.systemicDefect) !== null && _y !== void 0 ? _y : '', (_z = parsed === null || parsed === void 0 ? void 0 : parsed.defectRootCause) !== null && _z !== void 0 ? _z : '']);
        const reusablePatterns = uniqueStrings([
            ...((_0 = postmortem === null || postmortem === void 0 ? void 0 : postmortem.reusablePatterns) !== null && _0 !== void 0 ? _0 : []),
            (_1 = parsed === null || parsed === void 0 ? void 0 : parsed.reusablePattern) !== null && _1 !== void 0 ? _1 : '',
            (_2 = parsed === null || parsed === void 0 ? void 0 : parsed.fixApplied) !== null && _2 !== void 0 ? _2 : '',
            parsed === undefined ? entry.text : '',
        ]);
        return Object.assign(Object.assign(Object.assign(Object.assign({ id: `experience:${entry.id}`, runId }, (conceptId ? { conceptId } : {})), { projectId, schemaVersion: 'pyrfor.experience.v1', approvalState,
            legacy,
            quarantined, provenance: Object.assign(Object.assign(Object.assign(Object.assign({ sourceRunId: (_4 = (_3 = tagValue(entry.tags, 'sourceRunId:')) !== null && _3 !== void 0 ? _3 : parsed === null || parsed === void 0 ? void 0 : parsed.sourceRunId) !== null && _4 !== void 0 ? _4 : runId }, (conceptId ? { conceptId } : {})), (((_5 = tagValue(entry.tags, 'parentConceptId:')) !== null && _5 !== void 0 ? _5 : (_6 = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _6 === void 0 ? void 0 : _6.parentConceptId)
                ? { parentConceptId: (_7 = tagValue(entry.tags, 'parentConceptId:')) !== null && _7 !== void 0 ? _7 : (_8 = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _8 === void 0 ? void 0 : _8.parentConceptId }
                : {})), (((_9 = tagValue(entry.tags, 'retryOf:')) !== null && _9 !== void 0 ? _9 : (_10 = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _10 === void 0 ? void 0 : _10.retryOf)
                ? { retryOf: (_11 = tagValue(entry.tags, 'retryOf:')) !== null && _11 !== void 0 ? _11 : (_12 = parsed === null || parsed === void 0 ? void 0 : parsed.context) === null || _12 === void 0 ? void 0 : _12.retryOf }
                : {})), { memoryEntryIds: [entry.id], artifactIds }), retrievalKey: {
                fts: uniqueStrings([entry.text, ...entry.tags]).join('\n'),
                goalKeywords: keywords(entry.text),
                toolSignatures,
            } }), (domain ? { domain } : {})), { outcome: (_13 = postmortem === null || postmortem === void 0 ? void 0 : postmortem.outcome) !== null && _13 !== void 0 ? _13 : inferOutcome(parsed), whatWorked,
            whatFailed,
            reusablePatterns,
            verifierScore,
            acceptanceTestPassRate, wasPatternApplied: entry.applied_count > 0, patternEffectiveness: (_15 = (_14 = parsed === null || parsed === void 0 ? void 0 : parsed.impact) === null || _14 === void 0 ? void 0 : _14.observedScore) !== null && _15 !== void 0 ? _15 : (_16 = parsed === null || parsed === void 0 ? void 0 : parsed.impact) === null || _16 === void 0 ? void 0 : _16.predictedScore, createdAt: (_17 = parsed === null || parsed === void 0 ? void 0 : parsed.createdAt) !== null && _17 !== void 0 ? _17 : entry.created_at, indexedAt: indexedAt.toISOString(), sourceMemory: entry, sourceArtifacts });
    });
}
function matchesQuery(entry, q) {
    var _a, _b;
    if (q.audience === 'planner' && !isPlannerVisible(entry))
        return false;
    if (q.projectId !== '*' && entry.projectId !== q.projectId)
        return false;
    if (q.domain && entry.domain !== q.domain)
        return false;
    if (q.outcome && entry.outcome !== q.outcome)
        return false;
    if (q.includeFailed !== true && (entry.outcome === 'failed' || entry.outcome === 'blocked'))
        return false;
    if (q.minVerifierScore !== undefined && ((_a = entry.verifierScore) !== null && _a !== void 0 ? _a : 0) < q.minVerifierScore)
        return false;
    if (((_b = q.toolSignatures) === null || _b === void 0 ? void 0 : _b.length) && !q.toolSignatures.some((signature) => entry.retrievalKey.toolSignatures.includes(signature)))
        return false;
    return true;
}
function queryTags(q) {
    const tags = [];
    if (q.audience === 'planner')
        tags.push('approved');
    if (q.projectId !== '*')
        tags.push(`project:${q.projectId}`);
    return tags.length > 0 ? tags : undefined;
}
function isPlannerVisible(entry) {
    return entry.approvalState === 'approved' && !entry.legacy && !entry.quarantined;
}
function scoreEntry(entry, q) {
    var _a, _b;
    const queryTerms = q.goal ? keywords(q.goal) : [];
    const termHits = queryTerms.filter((term) => entry.retrievalKey.fts.toLowerCase().includes(term)).length;
    const toolBoost = ((_a = q.toolSignatures) === null || _a === void 0 ? void 0 : _a.some((signature) => entry.retrievalKey.toolSignatures.includes(signature))) ? 2 : 0;
    return termHits + toolBoost + ((_b = entry.verifierScore) !== null && _b !== void 0 ? _b : 0) + entry.sourceMemory.weight;
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new ExperienceLibraryError(`embedding dimension mismatch: expected ${a.length}, got ${b.length}`);
    }
    const normA = vectorNorm(a);
    const normB = vectorNorm(b);
    if (normA === 0 || normB === 0)
        return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i += 1)
        dot += a[i] * b[i];
    return dot / (normA * normB);
}
function vectorNorm(vector) {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
function parseLessonRecord(entry) {
    if (entry.kind !== 'lesson')
        return undefined;
    try {
        const parsed = JSON.parse(entry.text);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    }
    catch (_a) {
        return undefined;
    }
}
function inferOutcome(record) {
    if ((record === null || record === void 0 ? void 0 : record.algorithmOutcome) === 'worsened')
        return 'failed';
    if ((record === null || record === void 0 ? void 0 : record.status) === 'quarantined' || (record === null || record === void 0 ? void 0 : record.status) === 'rejected')
        return 'blocked';
    return 'completed';
}
function normalizeApprovalState(value) {
    if (value === 'approved')
        return 'approved';
    if (value === 'quarantined')
        return 'quarantined';
    return 'rejected';
}
function resolveIndexedArtifacts(artifactStore, artifactIds) {
    return __awaiter(this, void 0, void 0, function* () {
        if (artifactIds.length === 0)
            return [];
        const refs = yield artifactStore.listIndexed();
        const ids = new Set(artifactIds);
        return refs.filter((ref) => ids.has(ref.id));
    });
}
function readFirstPostmortem(artifactStore, refs) {
    return __awaiter(this, void 0, void 0, function* () {
        const postmortemRef = refs.find((ref) => ref.kind === 'postmortem_report');
        if (!postmortemRef)
            return undefined;
        const parsed = yield artifactStore.readJSON(postmortemRef);
        if (!isPostmortemShape(parsed))
            return undefined;
        return parsed;
    });
}
function isPostmortemShape(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const candidate = value;
    return candidate.outcome === undefined ||
        candidate.outcome === 'completed' ||
        candidate.outcome === 'failed' ||
        candidate.outcome === 'cancelled' ||
        candidate.outcome === 'blocked';
}
function dedupeMemoryEntries(entries) {
    const seen = new Set();
    const result = [];
    for (const entry of entries) {
        if (seen.has(entry.id))
            continue;
        seen.add(entry.id);
        result.push(entry);
    }
    return result;
}
function tagValue(tags, prefix) {
    var _a;
    return (_a = tags.find((tag) => tag.startsWith(prefix))) === null || _a === void 0 ? void 0 : _a.slice(prefix.length);
}
function tagValues(tags, prefix) {
    return tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}
function numberFromTag(tags, prefix) {
    const value = tagValue(tags, prefix);
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function keywords(text) {
    return uniqueStrings(text.toLowerCase().split(/[^a-zа-я0-9_:-]+/i).filter((term) => term.length > 2));
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
