/**
 * Memory System - Long-term memory with validity tracking
 *
 * Inspired by AGENTS.md memory protocol:
 * - Encoding: Save important facts immediately
 * - Consolidation: Review daily notes → update MEMORY.md
 * - Retrieval: Read MEMORY.md + recent notes before tasks
 */
export interface MemoryEntry {
    id: string;
    type: "long_term" | "episodic" | "procedural";
    category: "project" | "contact" | "fact" | "skill" | "decision" | "agent" | "chat";
    key: string;
    value: unknown;
    validFrom: string;
    validUntil: string | null;
    confidence: number;
    source: "user" | "analysis" | "research" | "system";
    tags: string[];
    createdAt: string;
    updatedAt: string;
}
export interface MemoryStats {
    totalEntries: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    oldestEntry: string | null;
    newestEntry: string | null;
    averageConfidence: number;
}
export declare const memoryManager: {
    /**
     * Add new memory entry
     */
    add(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): MemoryEntry;
    /**
     * Get entry by key
     */
    get(key: string): MemoryEntry | null;
    /**
     * Get all entries (optionally filter by type/category)
     */
    getAll(filters?: {
        type?: MemoryEntry["type"];
        category?: MemoryEntry["category"];
        tags?: string[];
    }): MemoryEntry[];
    /**
     * Update existing entry
     */
    update(id: string, updates: Partial<MemoryEntry>): MemoryEntry | null;
    /**
     * Delete entry by ID
     */
    delete(id: string): boolean;
    /**
     * Check if entry is still valid
     */
    isValid(entry: MemoryEntry): boolean;
    /**
     * Get memory statistics
     */
    getStats(): MemoryStats;
    /**
     * Search memories by query
     */
    search(query: string): MemoryEntry[];
    /**
     * Clear invalid entries (cleanup)
     */
    cleanup(): number;
    /**
     * Export all memories
     */
    export(): string;
    /**
     * Import memories
     */
    import(jsonString: string): number;
};
export declare const contextBuilder: {
    /**
     * Build context for AI prompt
     */
    build(options?: {
        projectId?: string;
        category?: MemoryEntry["category"];
        maxTokens?: number;
    }): string;
    /**
     * Build project-specific context
     */
    buildProjectContext(projectId: string): string;
};
export declare function initializeDefaultMemories(): void;
//# sourceMappingURL=memory-manager.d.ts.map