var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function createUniversalMemoryFacade(options) {
    function prefetch(request) {
        return __awaiter(this, void 0, void 0, function* () {
            const strategy = yield options.strategyProvider.prefetch(request);
            const approvedLessons = queryApprovedLessons({
                projectId: request.projectId,
                limit: request.limit,
            }).map(entryToSlice);
            const approvedStrategies = queryApprovedStrategies({
                projectId: request.projectId,
                limit: request.limit,
            }).map(entryToSlice);
            const slices = dedupeSlices([...strategy.slices, ...approvedStrategies, ...approvedLessons])
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
        }).filter((entry) => !entry.tags.includes('legacy') &&
            !entry.tags.includes('rejected') &&
            !entry.tags.includes('quarantined'));
    }
    function queryApprovedStrategies(request) {
        const tags = ['strategy', 'approved'];
        if (request.projectId)
            tags.push(`project:${request.projectId}`);
        return options.memoryStore.query({
            kind: 'strategy',
            tags,
            limit: request.limit,
        }).filter((entry) => !entry.tags.includes('legacy') &&
            !entry.tags.includes('rejected') &&
            !entry.tags.includes('quarantined'));
    }
    return { prefetch, queryApprovedLessons, queryApprovedStrategies };
}
function entryToSlice(entry) {
    return {
        id: entry.id,
        providerId: 'memory-facade',
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
