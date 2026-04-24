"use strict";
/**
 * Prisma Memory Manager - Database-backed memory system
 *
 * Stores memories in SQLite/PostgreSQL instead of localStorage
 * Provides same interface as memory-manager.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prismaContextBuilder = exports.prismaMemoryManager = void 0;
exports.initializeDefaultMemories = initializeDefaultMemories;
const db_1 = require("../db");
const logger_1 = require("../observability/logger");
const crypto_1 = require("crypto");
// ============================================
// Helper Functions
// ============================================
function parseValue(value) {
    if (value === null)
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function stringifyValue(value) {
    if (typeof value === 'string')
        return value;
    return JSON.stringify(value);
}
function toMemoryEntry(memory) {
    // Handle both SQLite (string) and PostgreSQL (Json) values
    const rawValue = typeof memory.value === 'string'
        ? memory.value
        : JSON.stringify(memory.value);
    return {
        id: memory.id,
        type: memory.type,
        category: memory.category,
        key: memory.key,
        value: parseValue(rawValue),
        validFrom: memory.validFrom,
        validUntil: memory.validUntil,
        confidence: memory.confidence,
        source: memory.source,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
    };
}
// ============================================
// Prisma Memory Manager
// ============================================
exports.prismaMemoryManager = {
    /**
     * Add new memory entry
     */
    async add(entry) {
        const memory = await db_1.prisma.memory.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                type: entry.type,
                category: entry.category,
                key: entry.key,
                value: stringifyValue(entry.value),
                validFrom: entry.validFrom,
                validUntil: entry.validUntil,
                confidence: entry.confidence,
                source: entry.source,
                updatedAt: new Date(),
            },
        });
        logger_1.logger.info("Added", { key: entry.key, type: entry.type, category: entry.category });
        return toMemoryEntry(memory);
    },
    /**
     * Get entry by key
     */
    async get(key) {
        const memories = await db_1.prisma.memory.findMany({
            where: { key },
            orderBy: { updatedAt: 'desc' },
        });
        for (const memory of memories) {
            if (this.isValid(toMemoryEntry(memory))) {
                return toMemoryEntry(memory);
            }
        }
        return null;
    },
    /**
     * Get entry by ID
     */
    async getById(id) {
        const memory = await db_1.prisma.memory.findUnique({
            where: { id },
        });
        if (!memory)
            return null;
        const entry = toMemoryEntry(memory);
        return this.isValid(entry) ? entry : null;
    },
    /**
     * Get all entries (optionally filter by type/category)
     */
    async getAll(filters) {
        const memories = await db_1.prisma.memory.findMany({
            where: {
                ...(filters?.type && { type: filters.type }),
                ...(filters?.category && { category: filters.category }),
            },
            orderBy: { updatedAt: 'desc' },
            take: filters?.limit || 100,
        });
        return memories
            .map(toMemoryEntry)
            .filter((entry) => this.isValid(entry));
    },
    /**
     * Update existing entry
     */
    async update(id, updates) {
        const data = {};
        if (updates.type !== undefined)
            data.type = updates.type;
        if (updates.category !== undefined)
            data.category = updates.category;
        if (updates.key !== undefined)
            data.key = updates.key;
        if (updates.value !== undefined)
            data.value = stringifyValue(updates.value);
        if (updates.validFrom !== undefined)
            data.validFrom = updates.validFrom;
        if (updates.validUntil !== undefined)
            data.validUntil = updates.validUntil;
        if (updates.confidence !== undefined)
            data.confidence = updates.confidence;
        if (updates.source !== undefined)
            data.source = updates.source;
        const memory = await db_1.prisma.memory.update({
            where: { id },
            data,
        });
        logger_1.logger.info("Updated", { key: memory.key });
        return toMemoryEntry(memory);
    },
    /**
     * Delete entry by ID
     */
    async delete(id) {
        try {
            await db_1.prisma.memory.delete({ where: { id } });
            logger_1.logger.info("Deleted", { id });
            return true;
        }
        catch (error) {
            logger_1.logger.error("Failed to delete memory", { id, error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    },
    /**
     * Delete entries by key
     */
    async deleteByKey(key) {
        const result = await db_1.prisma.memory.deleteMany({
            where: { key },
        });
        logger_1.logger.info("Deleted entries", { count: result.count, key });
        return result.count;
    },
    /**
     * Check if entry is still valid
     */
    isValid(entry) {
        // Check validity period
        if (entry.validUntil) {
            const now = new Date();
            if (now > entry.validUntil) {
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
    async getStats() {
        const memories = await db_1.prisma.memory.findMany();
        const validEntries = memories
            .map(toMemoryEntry)
            .filter((e) => this.isValid(e));
        const byType = {};
        const byCategory = {};
        let totalConfidence = 0;
        for (const entry of validEntries) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
            totalConfidence += entry.confidence;
        }
        const sorted = [...validEntries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return {
            totalEntries: validEntries.length,
            byType,
            byCategory,
            oldestEntry: sorted[0]?.createdAt || null,
            newestEntry: sorted[sorted.length - 1]?.createdAt || null,
            averageConfidence: validEntries.length > 0 ? totalConfidence / validEntries.length : 0,
        };
    },
    /**
     * Search memories by query
     */
    async search(query) {
        // Note: PostgreSQL Json type doesn't support 'contains', so we exclude value from search
        const memories = await db_1.prisma.memory.findMany({
            where: {
                OR: [
                    { key: { contains: query } },
                    { category: { contains: query } },
                    { type: { contains: query } },
                ],
            },
            orderBy: { updatedAt: 'desc' },
        });
        // Filter in memory for value content
        return memories
            .map(toMemoryEntry)
            .filter((e) => {
            // Check if query matches value (as JSON string)
            const valueStr = JSON.stringify(e.value).toLowerCase();
            return this.isValid(e) && (e.key.toLowerCase().includes(query.toLowerCase()) ||
                valueStr.includes(query.toLowerCase()));
        });
    },
    /**
     * Clear invalid entries (cleanup)
     */
    async cleanup() {
        const memories = await db_1.prisma.memory.findMany();
        const invalidIds = [];
        for (const memory of memories) {
            const entry = toMemoryEntry(memory);
            if (!this.isValid(entry)) {
                invalidIds.push(memory.id);
            }
        }
        if (invalidIds.length > 0) {
            await db_1.prisma.memory.deleteMany({
                where: { id: { in: invalidIds } },
            });
            logger_1.logger.warn("Cleaned up invalid entries", { count: invalidIds.length });
        }
        return invalidIds.length;
    },
    /**
     * Count total memories
     */
    async count() {
        return db_1.prisma.memory.count();
    },
};
// ============================================
// Prisma Context Builder
// ============================================
exports.prismaContextBuilder = {
    /**
     * Build context for AI prompt
     */
    async build(options) {
        const memories = await exports.prismaMemoryManager.getAll({
            category: options?.category,
        });
        // Sort by confidence and recency
        const sorted = memories.sort((a, b) => {
            const confidenceDiff = b.confidence - a.confidence;
            if (Math.abs(confidenceDiff) > 10)
                return confidenceDiff;
            return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
        // Build context string
        const lines = ['## Memory Context\n'];
        // Group by category
        const grouped = {};
        for (const entry of sorted) {
            if (!grouped[entry.category])
                grouped[entry.category] = [];
            grouped[entry.category].push(entry);
        }
        for (const [category, entries] of Object.entries(grouped)) {
            lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
            for (const entry of entries.slice(0, 5)) {
                // Max 5 per category
                const value = typeof entry.value === 'string'
                    ? entry.value
                    : JSON.stringify(entry.value);
                lines.push(`- **${entry.key}**: ${value}`);
                lines.push(`  _Confidence: ${entry.confidence}%, Source: ${entry.source}_`);
            }
            lines.push('');
        }
        const context = lines.join('\n');
        // Check token limit (rough estimate: 4 chars per token)
        const maxTokens = options?.maxTokens || 1000;
        const estimatedTokens = context.length / 4;
        if (estimatedTokens > maxTokens) {
            // Truncate
            const truncated = context.substring(0, maxTokens * 4);
            return truncated + '\n\n[Context truncated due to token limit]';
        }
        return context;
    },
    /**
     * Build project-specific context
     */
    async buildProjectContext(projectId) {
        // Search for memories mentioning this project
        const memories = await exports.prismaMemoryManager.search(projectId);
        if (memories.length === 0) {
            return 'No project-specific context available.';
        }
        const lines = ['## Project Context\n'];
        for (const entry of memories.slice(0, 10)) {
            const value = typeof entry.value === 'string'
                ? entry.value
                : JSON.stringify(entry.value);
            lines.push(`- **${entry.key}**: ${value}`);
        }
        return lines.join('\n');
    },
};
// ============================================
// Default Memories (for new installations)
// ============================================
async function initializeDefaultMemories() {
    const count = await exports.prismaMemoryManager.count();
    if (count > 0) {
        logger_1.logger.info("PrismaMemory already initialized");
        return;
    }
    // Add default memories
    await exports.prismaMemoryManager.add({
        type: 'procedural',
        category: 'skill',
        key: 'ai-provider',
        value: 'openrouter',
        validFrom: new Date(),
        validUntil: null,
        confidence: 100,
        source: 'system',
    });
    await exports.prismaMemoryManager.add({
        type: 'procedural',
        category: 'skill',
        key: 'default-model',
        value: 'google/gemini-3.1-flash-lite-preview',
        validFrom: new Date(),
        validUntil: null,
        confidence: 100,
        source: 'system',
    });
    logger_1.logger.info("Default memories initialized");
}
