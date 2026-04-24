/**
 * Prisma Memory Manager - Database-backed memory system
 *
 * Stores memories in SQLite/PostgreSQL instead of localStorage
 * Provides same interface as memory-manager.ts
 */
export interface MemoryEntry {
    id: string;
    type: "long_term" | "episodic" | "procedural";
    category: "project" | "contact" | "skill" | "fact" | "decision" | "agent" | "chat";
    key: string;
    value: unknown;
    validFrom: Date;
    validUntil: Date | null;
    confidence: number;
    source: "user" | "analysis" | "research" | "system";
    tags?: string[];
    createdAt: Date;
    updatedAt: Date;
}
export interface MemoryStats {
    totalEntries: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    averageConfidence: number;
}
export declare const prismaMemoryManager: {
    /**
     * Add new memory entry
     */
    add(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry>;
    /**
     * Get entry by key
     */
    get(key: string): Promise<MemoryEntry | null>;
    /**
     * Get entry by ID
     */
    getById(id: string): Promise<MemoryEntry | null>;
    /**
     * Get all entries (optionally filter by type/category)
     */
    getAll(filters?: {
        type?: MemoryEntry["type"];
        category?: MemoryEntry["category"];
        limit?: number;
    }): Promise<MemoryEntry[]>;
    /**
     * Update existing entry
     */
    update(id: string, updates: Partial<Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">>): Promise<MemoryEntry | null>;
    /**
     * Delete entry by ID
     */
    delete(id: string): Promise<boolean>;
    /**
     * Delete entries by key
     */
    deleteByKey(key: string): Promise<number>;
    /**
     * Check if entry is still valid
     */
    isValid(entry: MemoryEntry): boolean;
    /**
     * Get memory statistics
     */
    getStats(): Promise<MemoryStats>;
    /**
     * Search memories by query
     */
    search(query: string): Promise<MemoryEntry[]>;
    /**
     * Clear invalid entries (cleanup)
     */
    cleanup(): Promise<number>;
    /**
     * Count total memories
     */
    count(): Promise<number>;
};
export declare const prismaContextBuilder: {
    /**
     * Build context for AI prompt
     */
    build(options?: {
        category?: MemoryEntry["category"];
        maxTokens?: number;
    }): Promise<string>;
    /**
     * Build project-specific context
     */
    buildProjectContext(projectId: string): Promise<string>;
};
export declare function initializeDefaultMemories(): Promise<void>;
//# sourceMappingURL=prisma-memory-manager.d.ts.map