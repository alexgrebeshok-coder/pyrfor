var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createAlgorithmAwareRetriever, } from './algorithm-aware-retriever.js';
export class StrategyMemoryProvider {
    constructor(options) {
        var _a;
        this.id = 'strategy';
        this.memoryStore = options.memoryStore;
        this.lessonsStore = options.lessonsStore;
        this.retriever = (_a = options.retriever) !== null && _a !== void 0 ? _a : createAlgorithmAwareRetriever(options.memoryStore);
    }
    initialize(_context, strategy) {
        return __awaiter(this, void 0, void 0, function* () {
            this.strategy = strategy;
        });
    }
    prefetch(request) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const limit = request.limit || ((_a = this.strategy) === null || _a === void 0 ? void 0 : _a.maxSlices) || 10;
            const doubleLoop = this.lessonsStore
                ? this.lessonsStore
                    .topN(limit * 3, { tags: ['double_loop', 'approved'] })
                    .filter((lesson) => lesson.tags.includes('double_loop') && lesson.tags.includes('approved'))
                    .filter((lesson) => isPlannerVisibleApprovedMemory(lesson.tags, request.projectId))
                    .filter((lesson) => !request.projectId || lesson.tags.includes(`project:${request.projectId}`))
                    .slice(0, limit)
                    .map(lessonToSlice)
                : [];
            const retrieved = request.algorithm
                ? yield this.retriever.retrieve({
                    consumer: request.nodeKind === 'toolforge' ? 'toolforger' : 'strategist',
                    projectId: request.projectId,
                    algorithms: [request.algorithm],
                    phases: request.phase ? [request.phase] : undefined,
                    nodeKinds: request.nodeKind ? [request.nodeKind] : undefined,
                    ruleKeys: request.ruleKeys,
                    kinds: ['double_loop', 'single_loop', 'strategy'],
                    statuses: ['approved'],
                    excludeLegacy: true,
                    limit,
                })
                : [];
            const strategyEntries = this.memoryStore.query({
                kind: ['lesson', 'strategy'],
                tags: ['strategy', 'approved', ...(request.projectId ? [`project:${request.projectId}`] : [])],
                limit,
            })
                .filter((entry) => isPlannerVisibleApprovedMemory(entry.tags, request.projectId))
                .map(memoryEntryToSlice);
            const slices = [...doubleLoop, ...retrieved, ...strategyEntries]
                .sort((a, b) => b.priority - a.priority)
                .slice(0, limit);
            return { slices };
        });
    }
    syncTurn(_turn) {
        return __awaiter(this, void 0, void 0, function* () {
            return { wrote: 0, skipped: 0 };
        });
    }
    query(query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.memoryStore.query(query);
        });
    }
    compress(_scope) {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                providerId: this.id,
                compressed: 0,
                retained: 0,
                dropped: 0,
            };
        });
    }
    shutdown() {
        return __awaiter(this, void 0, void 0, function* () {
            return;
        });
    }
}
function lessonToSlice(lesson) {
    return {
        id: lesson.id,
        providerId: 'strategy',
        priority: 100 + lesson.weight,
        content: lesson.text,
        sourceRefs: [`lesson:${lesson.id}`],
    };
}
function memoryEntryToSlice(entry) {
    return {
        id: entry.id,
        providerId: 'strategy',
        priority: 50 + entry.weight,
        content: entry.text,
        sourceRefs: [entry.source],
    };
}
function hasAnyTag(itemTags, tags) {
    return tags.some((tag) => itemTags.includes(tag));
}
function isPlannerVisibleApprovedMemory(tags, projectId) {
    if (!tags.includes('approved'))
        return false;
    if (hasAnyTag(tags, ['legacy', 'rejected', 'quarantined', 'imported_quarantined']))
        return false;
    if (hasAnyTag(tags, ['approvalState:rejected', 'approvalState:quarantined']))
        return false;
    return projectId === undefined || tags.includes(`project:${projectId}`);
}
