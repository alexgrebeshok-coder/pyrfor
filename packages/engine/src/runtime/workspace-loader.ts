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

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { logger } from '../observability/logger';

// ============================================
// Types
// ============================================

export interface WorkspaceFiles {
  memory: string;              // MEMORY.md
  daily: Map<string, string>;  // memory/YYYY-MM-DD.md
  soul: string;                // SOUL.md
  user: string;                // USER.md
  identity: string;            // IDENTITY.md
  agents: string;              // AGENTS.md
  heartbeat: string;           // HEARTBEAT.md
  tools: string;               // TOOLS.md
  skills: string[];            // SKILL.md files
}

export interface LoadedWorkspace {
  files: WorkspaceFiles;
  systemPrompt: string;
  loadedAt: Date;
  errors: string[];
}

export interface WorkspaceLoaderOptions {
  workspacePath: string;
  memoryPath?: string;
  watch?: boolean;
  date?: string; // YYYY-MM-DD for daily notes
}

// ============================================
// File Loading Utilities
// ============================================

/**
 * Try to read a file, return empty string if not found
 */
async function tryReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    // Only log as debug if file not found (expected for optional files)
    const err = error as { code?: string };
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to read workspace file', { path: filePath, error: String(error) });
    }
    return '';
  }
}

/**
 * Find all SKILL.md files recursively
 */
async function findSkillFiles(basePath: string): Promise<string[]> {
  const skills: string[] = [];

  async function scan(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and hidden dirs
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          await scan(fullPath);
        } else if (entry.name.toLowerCase().endsWith('skill.md') || entry.name.toLowerCase().includes('skill')) {
          if (entry.name.toLowerCase().endsWith('.md')) {
            skills.push(fullPath);
          }
        }
      }
    } catch {
      // Directory might not exist or be inaccessible
    }
  }

  await scan(basePath);
  return skills;
}

/**
 * Load daily memory files for a date range
 */
async function loadDailyMemory(memoryPath: string, date: string): Promise<Map<string, string>> {
  const daily = new Map<string, string>();

  // Load the requested date
  const datePath = path.join(memoryPath, `${date}.md`);
  const content = await tryReadFile(datePath);
  if (content) {
    daily.set(date, content);
  }

  // Load previous 7 days as context
  const current = new Date(date);
  for (let i = 1; i <= 7; i++) {
    const prevDate = new Date(current);
    prevDate.setDate(prevDate.getDate() - i);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    const prevPath = path.join(memoryPath, `${prevDateStr}.md`);
    const prevContent = await tryReadFile(prevPath);
    if (prevContent) {
      daily.set(prevDateStr, prevContent);
    }
  }

  return daily;
}

// ============================================
// Workspace Loader
// ============================================

export class WorkspaceLoader {
  private options: WorkspaceLoaderOptions;
  private currentWorkspace: LoadedWorkspace | null = null;
  private watchers: fsSync.FSWatcher[] = [];

  constructor(options: WorkspaceLoaderOptions) {
    this.options = options;
  }

  /**
   * Load all workspace files
   */
  async load(): Promise<LoadedWorkspace> {
    const { workspacePath, memoryPath, date } = this.options;
    const memPath = memoryPath || path.join(workspacePath, 'memory');
    const today = date || new Date().toISOString().split('T')[0];

    const errors: string[] = [];

    // Load core memory files
    const memory = await tryReadFile(path.join(workspacePath, 'MEMORY.md'));
    const soul = await tryReadFile(path.join(workspacePath, 'SOUL.md'));
    const user = await tryReadFile(path.join(workspacePath, 'USER.md'));
    const identity = await tryReadFile(path.join(workspacePath, 'IDENTITY.md'));

    // Load config files
    const agents = await tryReadFile(path.join(workspacePath, 'AGENTS.md'));
    const heartbeat = await tryReadFile(path.join(workspacePath, 'HEARTBEAT.md'));
    const tools = await tryReadFile(path.join(workspacePath, 'TOOLS.md'));

    // Load daily memory
    const daily = await loadDailyMemory(memPath, today);

    // Find and load skill files
    const skillPaths = await findSkillFiles(workspacePath);
    const skills: string[] = [];
    for (const skillPath of skillPaths) {
      const content = await tryReadFile(skillPath);
      if (content) {
        skills.push(content);
      }
    }

    const files: WorkspaceFiles = {
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

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(files);

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
  }

  /**
   * Build system prompt from loaded files
   */
  private buildSystemPrompt(files: WorkspaceFiles): string {
    const parts: string[] = [];

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

    // Long-term memory
    if (files.memory) {
      parts.push('# Long-term Memory', files.memory, '');
    }

    // Recent daily notes (most recent first)
    if (files.daily.size > 0) {
      parts.push('# Recent Activity');
      const sortedDates = Array.from(files.daily.keys()).sort().reverse();
      for (const date of sortedDates) {
        const content = files.daily.get(date);
        if (content) {
          parts.push(`## ${date}`, content, '');
        }
      }
    }

    // Skill definitions
    if (files.skills.length > 0) {
      parts.push('# Available Skills', files.skills.join('\n\n---\n\n'));
    }

    // Tool capabilities
    if (files.tools) {
      parts.push('# Tool Capabilities', files.tools);
    }

    return parts.join('\n');
  }

  /**
   * Get the current workspace
   */
  getWorkspace(): LoadedWorkspace | null {
    return this.currentWorkspace;
  }

  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return this.currentWorkspace?.systemPrompt || '';
  }

  /**
   * Reload the workspace
   */
  async reload(): Promise<LoadedWorkspace> {
    this.stopWatching();
    return this.load();
  }

  /**
   * Start watching files for changes
   */
  private startWatching(): void {
    if (this.watchers.length > 0) return;

    try {
      // Watch main workspace files
      const watcher = fsSync.watch(this.options.workspacePath, { recursive: true }, (_event: fsSync.WatchEventType, filename: string | null) => {
        if (filename && (filename.endsWith('.md') || filename.endsWith('.mdx'))) {
          logger.info('Workspace file changed', { filename, event: _event });
          this.reload().catch(err => {
            logger.error('Failed to reload workspace', { error: String(err) });
          });
        }
      });

      this.watchers.push(watcher);
      logger.info('Started watching workspace files');
    } catch (error) {
      logger.error('Failed to start file watcher', { error: String(error) });
    }
  }

  /**
   * Stop watching files
   */
  private stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopWatching();
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Quick load workspace without managing instance
 */
export async function loadWorkspace(
  workspacePath: string,
  options?: Omit<WorkspaceLoaderOptions, 'workspacePath'>
): Promise<LoadedWorkspace> {
  const loader = new WorkspaceLoader({ workspacePath, ...options });
  return loader.load();
}

/**
 * Get context for a specific date
 */
export function getDailyContext(files: WorkspaceFiles, date: string): string {
  return files.daily.get(date) || '';
}

/**
 * Search memory files
 */
export function searchMemory(files: WorkspaceFiles, query: string): Array<{ source: string; snippet: string }> {
  const results: Array<{ source: string; snippet: string }> = [];
  const lowerQuery = query.toLowerCase();

  // Helper to search text
  const searchText = (text: string, source: string) => {
    if (!text) return;
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
