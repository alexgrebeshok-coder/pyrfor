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
export interface WorkspaceFiles {
    memory: string;
    daily: Map<string, string>;
    soul: string;
    user: string;
    identity: string;
    agents: string;
    heartbeat: string;
    tools: string;
    skills: string[];
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
    date?: string;
    /** Maximum system prompt size in characters (default: 30000) */
    maxPromptSize?: number;
}
export declare class WorkspaceLoader {
    private options;
    private currentWorkspace;
    private watchers;
    private readonly maxPromptSize;
    constructor(options: WorkspaceLoaderOptions);
    /**
     * Load all workspace files
     */
    load(): Promise<LoadedWorkspace>;
    /**
     * Build system prompt from loaded files with size limit.
     * If prompt exceeds maxSize, truncates less important sections.
     */
    private buildSystemPrompt;
    /**
     * Get the current workspace
     */
    getWorkspace(): LoadedWorkspace | null;
    /**
     * Get the system prompt
     */
    getSystemPrompt(): string;
    /**
     * Reload the workspace
     */
    reload(): Promise<LoadedWorkspace>;
    /**
     * Start watching files for changes
     */
    private startWatching;
    /**
     * Stop watching files
     */
    private stopWatching;
    /**
     * Dispose resources
     */
    dispose(): void;
}
/**
 * Quick load workspace without managing instance
 */
export declare function loadWorkspace(workspacePath: string, options?: Omit<WorkspaceLoaderOptions, 'workspacePath'>): Promise<LoadedWorkspace>;
/**
 * Get context for a specific date
 */
export declare function getDailyContext(files: WorkspaceFiles, date: string): string;
/**
 * Search memory files
 */
export declare function searchMemory(files: WorkspaceFiles, query: string): Array<{
    source: string;
    snippet: string;
}>;
