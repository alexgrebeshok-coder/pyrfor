/**
 * Memory System - Long-term memory with validity tracking
 *
 * Inspired by AGENTS.md memory protocol:
 * - Encoding: Save important facts immediately
 * - Consolidation: Review daily notes → update MEMORY.md
 * - Retrieval: Read MEMORY.md + recent notes before tasks
 */
import { logger } from '../observability/logger.js';
// ============================================
// Storage Keys
// ============================================
const MEMORY_KEY = "ceoclaw-memory";
// ============================================
// Helper Functions
// ============================================
function generateId() {
    return `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
function getMemoryStorage() {
    if (typeof window === "undefined")
        return [];
    try {
        const stored = localStorage.getItem(MEMORY_KEY);
        return stored ? JSON.parse(stored) : [];
    }
    catch (error) {
        logger.error("Memory read error", { error: error instanceof Error ? error.message : String(error) });
        return [];
    }
}
function setMemoryStorage(entries) {
    if (typeof window === "undefined")
        return;
    try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(entries));
    }
    catch (error) {
        logger.error("[Memory] Error writing:", { error: error instanceof Error ? error.message : String(error) });
    }
}
// ============================================
// Memory Manager
// ============================================
export const memoryManager = {
    /**
     * Add new memory entry
     */
    add(entry) {
        const now = new Date().toISOString();
        const newEntry = Object.assign(Object.assign({}, entry), { id: generateId(), createdAt: now, updatedAt: now });
        const entries = getMemoryStorage();
        entries.push(newEntry);
        setMemoryStorage(entries);
        logger.info("Added", { key: entry.key, type: entry.type, category: entry.category });
        return newEntry;
    },
    /**
     * Get entry by key
     */
    get(key) {
        const entries = getMemoryStorage();
        return entries.find((e) => e.key === key && this.isValid(e)) || null;
    },
    /**
     * Get all entries (optionally filter by type/category)
     */
    getAll(filters) {
        let entries = getMemoryStorage();
        if (filters === null || filters === void 0 ? void 0 : filters.type) {
            entries = entries.filter((e) => e.type === filters.type);
        }
        if (filters === null || filters === void 0 ? void 0 : filters.category) {
            entries = entries.filter((e) => e.category === filters.category);
        }
        if ((filters === null || filters === void 0 ? void 0 : filters.tags) && filters.tags.length > 0) {
            entries = entries.filter((e) => filters.tags.some((tag) => e.tags.includes(tag)));
        }
        return entries.filter((e) => this.isValid(e));
    },
    /**
     * Update existing entry
     */
    update(id, updates) {
        const entries = getMemoryStorage();
        const index = entries.findIndex((e) => e.id === id);
        if (index === -1)
            return null;
        entries[index] = Object.assign(Object.assign(Object.assign({}, entries[index]), updates), { updatedAt: new Date().toISOString() });
        setMemoryStorage(entries);
        logger.info("Updated", { key: entries[index].key });
        return entries[index];
    },
    /**
     * Delete entry by ID
     */
    delete(id) {
        const entries = getMemoryStorage();
        const index = entries.findIndex((e) => e.id === id);
        if (index === -1)
            return false;
        entries.splice(index, 1);
        setMemoryStorage(entries);
        logger.info("Deleted", { id });
        return true;
    },
    /**
     * Check if entry is still valid
     */
    isValid(entry) {
        // Check validity period
        if (entry.validUntil) {
            const now = new Date();
            const validUntil = new Date(entry.validUntil);
            if (now > validUntil) {
                return false;
            }
        }
        // Check confidence threshold
        if (entry.confidence < 50) {
            return false;
        }
        return true;
    },
    /**
     * Get memory statistics
     */
    getStats() {
        var _a, _b;
        const entries = getMemoryStorage();
        const validEntries = entries.filter((e) => this.isValid(e));
        const byType = {};
        const byCategory = {};
        let totalConfidence = 0;
        for (const entry of validEntries) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
            totalConfidence += entry.confidence;
        }
        const sorted = [...validEntries].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        return {
            totalEntries: validEntries.length,
            byType,
            byCategory,
            oldestEntry: ((_a = sorted[0]) === null || _a === void 0 ? void 0 : _a.createdAt) || null,
            newestEntry: ((_b = sorted[sorted.length - 1]) === null || _b === void 0 ? void 0 : _b.createdAt) || null,
            averageConfidence: validEntries.length > 0 ? totalConfidence / validEntries.length : 0,
        };
    },
    /**
     * Search memories by query
     */
    search(query) {
        const entries = getMemoryStorage();
        const lowerQuery = query.toLowerCase();
        return entries.filter((e) => {
            if (!this.isValid(e))
                return false;
            const searchable = [
                e.key,
                e.category,
                e.type,
                ...e.tags,
                JSON.stringify(e.value),
            ]
                .join(" ")
                .toLowerCase();
            return searchable.includes(lowerQuery);
        });
    },
    /**
     * Clear invalid entries (cleanup)
     */
    cleanup() {
        const entries = getMemoryStorage();
        const validEntries = entries.filter((e) => this.isValid(e));
        const removed = entries.length - validEntries.length;
        if (removed > 0) {
            setMemoryStorage(validEntries);
            logger.warn("Cleaned up invalid entries", { count: removed });
        }
        return removed;
    },
    /**
     * Export all memories
     */
    export() {
        const entries = getMemoryStorage();
        return JSON.stringify({
            version: 1,
            exportedAt: new Date().toISOString(),
            entries,
        }, null, 2);
    },
    /**
     * Import memories
     */
    import(jsonString) {
        try {
            const { entries } = JSON.parse(jsonString);
            const existing = getMemoryStorage();
            // Merge, avoiding duplicates by key
            const merged = [...existing];
            for (const entry of entries) {
                if (!merged.find((e) => e.key === entry.key)) {
                    merged.push(entry);
                }
            }
            setMemoryStorage(merged);
            logger.info("Memory imported", { count: entries.length });
            return entries.length;
        }
        catch (error) {
            logger.error("Import error", { error: error instanceof Error ? error.message : String(error) });
            return 0;
        }
    },
};
// ============================================
// Context Builder - Assemble context for AI
// ============================================
export const contextBuilder = {
    /**
     * Build context for AI prompt
     */
    build(options) {
        const memories = memoryManager.getAll({
            category: options === null || options === void 0 ? void 0 : options.category,
        });
        // Sort by confidence and recency
        const sorted = memories.sort((a, b) => {
            const confidenceDiff = b.confidence - a.confidence;
            if (Math.abs(confidenceDiff) > 10)
                return confidenceDiff;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        // Build context string
        const lines = ["## Memory Context\n"];
        // Group by category
        const grouped = {};
        for (const entry of sorted) {
            if (!grouped[entry.category])
                grouped[entry.category] = [];
            grouped[entry.category].push(entry);
        }
        for (const [category, entries] of Object.entries(grouped)) {
            lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
            for (const entry of entries.slice(0, 5)) { // Max 5 per category
                const value = typeof entry.value === "string"
                    ? entry.value
                    : JSON.stringify(entry.value);
                lines.push(`- **${entry.key}**: ${value}`);
                lines.push(`  _Confidence: ${entry.confidence}%, Source: ${entry.source}_`);
            }
            lines.push("");
        }
        const context = lines.join("\n");
        // Check token limit (rough estimate: 4 chars per token)
        const maxTokens = (options === null || options === void 0 ? void 0 : options.maxTokens) || 1000;
        const estimatedTokens = context.length / 4;
        if (estimatedTokens > maxTokens) {
            // Truncate
            const truncated = context.substring(0, maxTokens * 4);
            return truncated + "\n\n[Context truncated due to token limit]";
        }
        return context;
    },
    /**
     * Build project-specific context
     */
    buildProjectContext(projectId) {
        const memories = memoryManager.getAll().filter((e) => e.tags.includes(projectId));
        if (memories.length === 0) {
            return "No project-specific context available.";
        }
        const lines = ["## Project Context\n"];
        for (const entry of memories) {
            const value = typeof entry.value === "string"
                ? entry.value
                : JSON.stringify(entry.value);
            lines.push(`- **${entry.key}**: ${value}`);
        }
        return lines.join("\n");
    },
};
// ============================================
// Default Memories (for new users)
// ============================================
export function initializeDefaultMemories() {
    const existing = memoryManager.getAll();
    if (existing.length > 0) {
        logger.info("Memory already initialized");
        return;
    }
    // Add default memories
    memoryManager.add({
        type: "procedural",
        category: "skill",
        key: "ai-provider",
        value: "openrouter",
        validFrom: new Date().toISOString(),
        validUntil: null,
        confidence: 100,
        source: "system",
        tags: ["ai", "config"],
    });
    memoryManager.add({
        type: "procedural",
        category: "skill",
        key: "default-model",
        value: "google/gemini-3.1-flash-lite-preview",
        validFrom: new Date().toISOString(),
        validUntil: null,
        confidence: 100,
        source: "system",
        tags: ["ai", "config"],
    });
    logger.info("Default memories initialized");
}
