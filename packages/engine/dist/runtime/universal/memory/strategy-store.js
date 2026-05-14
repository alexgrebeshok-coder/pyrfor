const STRATEGY_SCOPE = 'strategy';
const EXCLUDED_TAGS = ['legacy', 'rejected', 'quarantined'];
export function createStrategyStore(memoryStore) {
    function setApproved(input) {
        var _a, _b, _c;
        const existing = findExisting(input.key, input.projectId);
        const tags = strategyTags(input);
        const source = (_a = input.sourceArtifactRef) !== null && _a !== void 0 ? _a : `strategy:${input.source}`;
        if (existing) {
            const updated = memoryStore.update(existing.id, {
                text: input.value,
                source,
                tags,
                weight: clampWeight((_b = input.impactScore) !== null && _b !== void 0 ? _b : existing.weight),
                scope: STRATEGY_SCOPE,
                kind: 'strategy',
            });
            if (!updated)
                throw new Error(`StrategyStore: failed to update strategy "${input.key}"`);
            return entryToStrategy(updated);
        }
        const created = memoryStore.add({
            kind: 'strategy',
            text: input.value,
            source,
            scope: STRATEGY_SCOPE,
            tags,
            weight: clampWeight((_c = input.impactScore) !== null && _c !== void 0 ? _c : 1),
        });
        return entryToStrategy(created);
    }
    function getApproved(key, options = {}) {
        const projectEntry = options.projectId
            ? queryApproved({ tags: [`key:${key}`, `project:${options.projectId}`], limit: 1 })[0]
            : undefined;
        if (projectEntry)
            return entryToStrategy(projectEntry);
        if (options.projectId && !options.includeGlobal)
            return undefined;
        return queryApproved({ tags: [`key:${key}`], limit: 10 })
            .filter((entry) => !hasProjectTag(entry))
            .map(entryToStrategy)[0];
    }
    function listApproved(query = {}) {
        var _a;
        const tags = [...(query.domain ? [`domain:${query.domain}`] : [])];
        if (query.projectId && !query.includeGlobal)
            tags.push(`project:${query.projectId}`);
        return queryApproved({ tags, limit: (_a = query.limit) !== null && _a !== void 0 ? _a : 100 })
            .filter((entry) => query.projectId
            ? entry.tags.includes(`project:${query.projectId}`) || (query.includeGlobal === true && !hasProjectTag(entry))
            : !hasProjectTag(entry))
            .map(entryToStrategy);
    }
    function findExisting(key, projectId) {
        const entries = queryApproved({ tags: [`key:${key}`], limit: 100 });
        return entries.find((entry) => projectId
            ? entry.tags.includes(`project:${projectId}`)
            : !hasProjectTag(entry));
    }
    function queryApproved(input) {
        var _a;
        return memoryStore.query({
            scope: STRATEGY_SCOPE,
            kind: 'strategy',
            tags: ['strategy', 'approved', ...((_a = input.tags) !== null && _a !== void 0 ? _a : [])],
            limit: input.limit,
        }).filter((entry) => !hasAnyTag(entry.tags, EXCLUDED_TAGS));
    }
    return { setApproved, getApproved, listApproved };
}
export function entryToStrategy(entry) {
    const key = readTagValue(entry.tags, 'key:');
    if (!key)
        throw new Error(`StrategyStore: strategy entry "${entry.id}" is missing key tag`);
    const source = readTagValue(entry.tags, 'source:') === 'historian-distilled'
        ? 'historian-distilled'
        : 'user';
    const algorithm = readAlgorithmTag(entry.tags);
    return {
        memoryEntryId: entry.id,
        key,
        value: entry.text,
        domain: readTagValue(entry.tags, 'domain:'),
        projectId: readTagValue(entry.tags, 'project:'),
        source,
        sourceArtifactRef: entry.source.startsWith('strategy:') ? undefined : entry.source,
        impactScore: entry.weight,
        governedByAlgorithm: algorithm,
        decisionRecordRef: readTagValue(entry.tags, 'decision:'),
        approval: 'approved',
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
    };
}
function strategyTags(input) {
    return [
        'strategy',
        'approved',
        `key:${input.key}`,
        `source:${input.source}`,
        ...(input.domain ? [`domain:${input.domain}`] : []),
        ...(input.projectId ? [`project:${input.projectId}`] : []),
        ...(input.governedByAlgorithm ? [input.governedByAlgorithm] : []),
        ...(input.decisionRecordRef ? [`decision:${input.decisionRecordRef}`] : []),
    ];
}
function readAlgorithmTag(tags) {
    const algorithms = [
        'strategic_planning',
        'research_tool_creation',
        'execution_quality_control',
        'lessons_learned',
        'system_self_improvement',
    ];
    return algorithms.find((algorithm) => tags.includes(algorithm));
}
function readTagValue(tags, prefix) {
    var _a;
    return (_a = tags.find((tag) => tag.startsWith(prefix))) === null || _a === void 0 ? void 0 : _a.slice(prefix.length);
}
function hasProjectTag(entry) {
    return entry.tags.some((tag) => tag.startsWith('project:'));
}
function hasAnyTag(itemTags, tags) {
    return tags.some((tag) => itemTags.includes(tag));
}
function clampWeight(weight) {
    if (!Number.isFinite(weight))
        return 1;
    return Math.max(0, Math.min(1, weight));
}
