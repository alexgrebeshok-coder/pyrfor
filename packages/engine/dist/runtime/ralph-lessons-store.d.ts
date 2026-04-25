export interface LessonEntry {
    id: string;
    iteration: number;
    task?: string;
    text: string;
    tags: string[];
    weight: number;
    createdAt: string;
}
export interface LessonsStoreOptions {
    dir?: string;
    fileNameFor?: (date: Date) => string;
    maxEntries?: number;
}
export interface LessonsStore {
    add(entry: Omit<LessonEntry, 'id' | 'createdAt'>): LessonEntry;
    list(filter?: {
        tags?: string[];
        sinceDays?: number;
    }): LessonEntry[];
    topN(n: number, filter?: {
        tags?: string[];
    }): LessonEntry[];
    renderMarkdown(filter?: {
        tags?: string[];
        sinceDays?: number;
        limit?: number;
    }): string;
    clear(): void;
    flush(): void;
    load(): void;
}
export declare function createLessonsStore(opts?: LessonsStoreOptions): LessonsStore;
export declare function extractLessons(input: {
    iteration: number;
    agentOutput: string;
    verifySummary: string;
    task?: string;
}): Array<Omit<LessonEntry, 'id' | 'createdAt'>>;
//# sourceMappingURL=ralph-lessons-store.d.ts.map