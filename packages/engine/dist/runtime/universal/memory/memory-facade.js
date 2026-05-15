var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { hasMemoryCapabilityForTier } from '../../block-memory-namespace.js';
export function createUniversalMemoryFacade(options) {
    function prefetch(request) {
        return __awaiter(this, void 0, void 0, function* () {
            const strategy = yield options.strategyProvider.prefetch(request);
            const approvedLessons = queryApprovedLessons({
                projectId: request.projectId,
                limit: request.limit,
            }).map((entry) => entryToSlice(entry));
            const approvedStrategies = queryApprovedStrategies({
                projectId: request.projectId,
                limit: request.limit,
            }).map((entry) => entryToSlice(entry));
            const blockProjectShared = queryBlockProjectSharedSlices({
                projectId: request.projectId,
                limit: request.limit,
            });
            const slices = dedupeSlices([...strategy.slices, ...approvedStrategies, ...approvedLessons, ...blockProjectShared])
                .sort((a, b) => b.priority - a.priority)
                .slice(0, request.limit);
            return Object.assign(Object.assign({}, strategy), { slices });
        });
    }
    function queryApprovedLessons(request) {
        const tags = ['approved'];
        if (request.projectId)
            tags.push(`project:${request.projectId}`);
        return options.memoryStore.query({
            kind: 'lesson',
            tags,
            limit: request.limit,
        }).filter((entry) => isPlannerVisibleApprovedMemory(entry.tags, request.projectId));
    }
    function queryBlockProjectSharedSlices(request) {
        if (!options.blockRegistry || !request.projectId)
            return [];
        const slices = [];
        for (const entry of options.blockRegistry.list({ status: 'active', projectId: request.projectId })) {
            if (!entry.memoryScopeMap || !hasMemoryCapabilityForTier(entry.manifest, 'project_shared', 'read'))
                continue;
            for (const namespace of entry.memoryScopeMap.values()) {
                if (namespace.tier !== 'project_shared')
                    continue;
                const memories = options.memoryStore.query({
                    scope: namespace.scope,
                    limit: request.limit,
                }).filter((memory) => isPlannerVisibleApprovedMemory(memory.tags, request.projectId));
                for (const memory of memories) {
                    slices.push(entryToSlice(memory, 'block-project-shared'));
                }
            }
        }
        return slices;
    }
    function queryApprovedStrategies(request) {
        const tags = ['strategy', 'approved'];
        if (request.projectId)
            tags.push(`project:${request.projectId}`);
        return options.memoryStore.query({
            kind: 'strategy',
            tags,
            limit: request.limit,
        }).filter((entry) => isPlannerVisibleApprovedMemory(entry.tags, request.projectId));
    }
    return { prefetch, queryApprovedLessons, queryApprovedStrategies };
}
function isPlannerVisibleApprovedMemory(tags, projectId) {
    if (!tags.includes('approved'))
        return false;
    if (tags.some((tag) => tag === 'legacy' || tag === 'rejected' || tag === 'quarantined' || tag === 'imported_quarantined')) {
        return false;
    }
    if (tags.includes('approvalState:rejected') || tags.includes('approvalState:quarantined')) {
        return false;
    }
    return projectId === undefined || tags.includes(`project:${projectId}`);
}
function entryToSlice(entry, providerId = 'memory-facade') {
    return {
        id: entry.id,
        providerId,
        priority: 75 + entry.weight,
        content: entry.text,
        sourceRefs: [entry.source],
    };
}
function dedupeSlices(slices) {
    const seen = new Set();
    const result = [];
    for (const slice of slices) {
        const key = slice.id;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(slice);
    }
    return result;
}
