/**
 * Workspace File Loader — Load memory and configuration files
 *
 * Features:
 * - Load MEMORY.md (long-term memory)
 * - Load memory/YYYY-MM-DD.md (daily files)
 * - Load SOUL.md, USER.md, IDENTITY.md
 * - Load AGENTS.md, HEARTBEAT.md, TOOLS.md
 * - Load SKILL.md files
 * - Build system prompt from loaded files
 * - Watch for file changes (optional)
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { logger } from '../observability/logger.js';
// ============================================
// File Loading Utilities
// ============================================
/**
 * Try to read a file, return empty string if not found
 */
function tryReadFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield fs.readFile(filePath, 'utf-8');
        }
        catch (error) {
            // Only log as debug if file not found (expected for optional files)
            const err = error;
            if (err.code !== 'ENOENT') {
                logger.warn('Failed to read workspace file', { path: filePath, error: String(error) });
            }
            return '';
        }
    });
}
/**
 * Find all SKILL.md files recursively
 */
function findSkillFiles(basePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const skills = [];
        function scan(dir) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const entries = yield fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            // Skip node_modules and hidden dirs
                            if (entry.name === 'node_modules' || entry.name.startsWith('.'))
                                continue;
                            yield scan(fullPath);
                        }
                        else if (entry.name.toLowerCase().endsWith('skill.md') || entry.name.toLowerCase().includes('skill')) {
                            if (entry.name.toLowerCase().endsWith('.md')) {
                                skills.push(fullPath);
                            }
                        }
                    }
                }
                catch (_a) {
                    // Directory might not exist or be inaccessible
                }
            });
        }
        yield scan(basePath);
        return skills;
    });
}
/**
 * Load daily memory files for a date range.
 * Uses local date arithmetic to avoid timezone issues with ISO strings.
 */
function loadDailyMemory(memoryPath, date) {
    return __awaiter(this, void 0, void 0, function* () {
        const daily = new Map();
        // Load the requested date
        const datePath = path.join(memoryPath, `${date}.md`);
        const content = yield tryReadFile(datePath);
        if (content) {
            daily.set(date, content);
        }
        // Parse date components to avoid UTC/local timezone mismatch
        const [year, month, day] = date.split('-').map(Number);
        const current = new Date(year, month - 1, day);
        // Load previous 7 days as context
        for (let i = 1; i <= 7; i++) {
            const prevDate = new Date(current);
            prevDate.setDate(prevDate.getDate() - i);
            const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
            const prevPath = path.join(memoryPath, `${prevDateStr}.md`);
            const prevContent = yield tryReadFile(prevPath);
            if (prevContent) {
                daily.set(prevDateStr, prevContent);
            }
        }
        return daily;
    });
}
// ============================================
// Workspace Loader
// ============================================
export class WorkspaceLoader {
    constructor(options) {
        this.currentWorkspace = null;
        this.watchers = [];
        this.options = options;
        this.maxPromptSize = options.maxPromptSize || 30000;
    }
    /**
     * Load all workspace files
     */
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            const { workspacePath, memoryPath, date } = this.options;
            const memPath = memoryPath || path.join(workspacePath, 'memory');
            const today = date || new Date().toISOString().split('T')[0];
            const errors = [];
            // Load core memory files
            const memory = yield tryReadFile(path.join(workspacePath, 'MEMORY.md'));
            const soul = yield tryReadFile(path.join(workspacePath, 'SOUL.md'));
            const user = yield tryReadFile(path.join(workspacePath, 'USER.md'));
            const identity = yield tryReadFile(path.join(workspacePath, 'IDENTITY.md'));
            // Load config files
            const agents = yield tryReadFile(path.join(workspacePath, 'AGENTS.md'));
            const heartbeat = yield tryReadFile(path.join(workspacePath, 'HEARTBEAT.md'));
            const tools = yield tryReadFile(path.join(workspacePath, 'TOOLS.md'));
            // Load daily memory
            const daily = yield loadDailyMemory(memPath, today);
            // Find and load skill files
            const skillPaths = yield findSkillFiles(workspacePath);
            const skills = [];
            for (const skillPath of skillPaths) {
                const content = yield tryReadFile(skillPath);
                if (content) {
                    skills.push(content);
                }
            }
            const files = {
                memory,
                daily,
                soul,
                user,
                identity,
                agents,
                heartbeat,
                tools,
                skills,
            };
            // Build system prompt (with size limit)
            const systemPrompt = this.buildSystemPrompt(files, this.maxPromptSize);
            this.currentWorkspace = {
                files,
                systemPrompt,
                loadedAt: new Date(),
                errors,
            };
            if (this.options.watch) {
                this.startWatching();
            }
            logger.info('Workspace loaded', {
                path: workspacePath,
                hasMemory: !!memory,
                dailyCount: daily.size,
                skillCount: skills.length,
            });
            return this.currentWorkspace;
        });
    }
    /**
     * Build system prompt from loaded files with size limit.
     * If prompt exceeds maxSize, truncates less important sections.
     */
    buildSystemPrompt(files, maxSize) {
        const parts = [];
        // Identity comes first (who the AI is)
        if (files.identity) {
            parts.push('# Identity', files.identity, '');
        }
        // Soul (personality, values)
        if (files.soul) {
            parts.push('# Core Values', files.soul, '');
        }
        // User context (who the user is)
        if (files.user) {
            parts.push('# User Context', files.user, '');
        }
        // Long-term memory (truncate if too large)
        if (files.memory) {
            if (files.memory.length > 10000) {
                // Keep first 5000 + last 5000 chars of memory
                const truncated = files.memory.slice(0, 5000) + '\n\n... [truncated] ...\n\n' + files.memory.slice(-5000);
                parts.push('# Long-term Memory', truncated, '');
            }
            else {
                parts.push('# Long-term Memory', files.memory, '');
            }
        }
        // Recent daily notes (most recent first, limit to last 3 days)
        if (files.daily.size > 0) {
            parts.push('# Recent Activity');
            const sortedDates = Array.from(files.daily.keys()).sort().reverse().slice(0, 3);
            for (const date of sortedDates) {
                const content = files.daily.get(date);
                if (content) {
                    parts.push(`## ${date}`, content, '');
                }
            }
        }
        // Tool capabilities (always include)
        if (files.tools) {
            parts.push('# Tool Capabilities', files.tools);
        }
        // Skills (only if we have room)
        if (files.skills.length > 0) {
            const currentSize = parts.join('\n').length;
            const remaining = maxSize - currentSize;
            if (remaining > 2000) {
                // Limit skills to fit remaining space
                let skillsContent = files.skills.join('\n\n---\n\n');
                if (skillsContent.length > remaining) {
                    skillsContent = skillsContent.slice(0, remaining) + '\n\n... [skills truncated]';
                }
                parts.push('# Available Skills', skillsContent);
            }
        }
        const prompt = parts.join('\n');
        // Final safety: if still too large, truncate from the end
        if (prompt.length > maxSize) {
            return prompt.slice(0, maxSize) + '\n\n... [context truncated due to size limit]';
        }
        return prompt;
    }
    /**
     * Get the current workspace
     */
    getWorkspace() {
        return this.currentWorkspace;
    }
    /**
     * Get the system prompt
     */
    getSystemPrompt() {
        var _a;
        return ((_a = this.currentWorkspace) === null || _a === void 0 ? void 0 : _a.systemPrompt) || '';
    }
    /**
     * Reload the workspace
     */
    reload() {
        return __awaiter(this, void 0, void 0, function* () {
            this.stopWatching();
            return this.load();
        });
    }
    /**
     * Start watching files for changes
     */
    startWatching() {
        if (this.watchers.length > 0)
            return;
        try {
            // Watch main workspace files
            const watcher = fsSync.watch(this.options.workspacePath, { recursive: true }, (_event, filename) => {
                if (filename && (filename.endsWith('.md') || filename.endsWith('.mdx'))) {
                    logger.info('Workspace file changed', { filename, event: _event });
                    this.reload().catch(err => {
                        logger.error('Failed to reload workspace', { error: String(err) });
                    });
                }
            });
            this.watchers.push(watcher);
            logger.info('Started watching workspace files');
        }
        catch (error) {
            logger.error('Failed to start file watcher', { error: String(error) });
        }
    }
    /**
     * Stop watching files
     */
    stopWatching() {
        for (const watcher of this.watchers) {
            watcher.close();
        }
        this.watchers = [];
    }
    /**
     * Dispose resources
     */
    dispose() {
        this.stopWatching();
    }
}
// ============================================
// Utility Functions
// ============================================
/**
 * Quick load workspace without managing instance
 */
export function loadWorkspace(workspacePath, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const loader = new WorkspaceLoader(Object.assign({ workspacePath }, options));
        return loader.load();
    });
}
/**
 * Get context for a specific date
 */
export function getDailyContext(files, date) {
    return files.daily.get(date) || '';
}
/**
 * Search memory files
 */
export function searchMemory(files, query) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    // Helper to search text
    const searchText = (text, source) => {
        if (!text)
            return;
        const lowerText = text.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);
        if (index !== -1) {
            const start = Math.max(0, index - 50);
            const end = Math.min(text.length, index + query.length + 50);
            results.push({
                source,
                snippet: text.slice(start, end),
            });
        }
    };
    searchText(files.memory, 'MEMORY.md');
    searchText(files.soul, 'SOUL.md');
    searchText(files.user, 'USER.md');
    searchText(files.identity, 'IDENTITY.md');
    for (const [date, content] of files.daily) {
        searchText(content, `memory/${date}.md`);
    }
    for (let i = 0; i < files.skills.length; i++) {
        searchText(files.skills[i], `SKILL-${i}.md`);
    }
    return results;
}
