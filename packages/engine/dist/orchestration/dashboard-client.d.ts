/**
 * DashboardClient — HTTP client for OpenClaw integration
 *
 * Allows OpenClaw agents to interact with pm-dashboard API
 * via HTTP requests (create/read/update operations)
 */
import type { Project, Task, TeamMember, Risk } from "../types/types";
/**
 * Input types for API operations
 */
export interface CreateProjectInput {
    name: string;
    description?: string;
    status: "active" | "planning" | "on-hold" | "completed" | "cancelled";
    priority: "critical" | "high" | "medium" | "low";
    budget: {
        planned: number;
        actual: number;
        currency: string;
    };
    dates: {
        start: string;
        end: string;
    };
    manager: string;
    team: string[];
    tags?: string[];
}
export interface CreateTaskInput {
    projectId: string;
    title: string;
    description?: string;
    status: "todo" | "in-progress" | "review" | "done" | "blocked";
    priority: "critical" | "high" | "medium" | "low";
    assignee?: string;
    dueDate?: string;
    tags?: string[];
}
export interface UpdateProjectInput {
    name?: string;
    description?: string;
    status?: "active" | "planning" | "on-hold" | "completed" | "cancelled";
    priority?: "critical" | "high" | "medium" | "low";
    budget?: {
        planned: number;
        actual: number;
        currency: string;
    };
    dates?: {
        start: string;
        end: string;
    };
    progress?: number;
    manager?: string;
    team?: string[];
    tags?: string[];
}
export interface UpdateTaskInput {
    title?: string;
    description?: string;
    status?: "todo" | "in-progress" | "review" | "done" | "blocked";
    priority?: "critical" | "high" | "medium" | "low";
    assignee?: string;
    dueDate?: string;
    progress?: number;
    tags?: string[];
}
/**
 * API Error class
 */
export declare class DashboardAPIError extends Error {
    status: number;
    endpoint: string;
    details?: unknown | undefined;
    constructor(message: string, status: number, endpoint: string, details?: unknown | undefined);
}
/**
 * DashboardClient — HTTP client for dashboard API
 */
export declare class DashboardClient {
    private baseUrl;
    private apiKey;
    constructor(baseUrl?: string, apiKey?: string | null);
    /**
     * Make authenticated HTTP request
     */
    private request;
    /**
     * List all projects
     */
    listProjects(): Promise<Project[]>;
    /**
     * Get single project by ID
     */
    getProject(id: string): Promise<Project>;
    /**
     * Create new project
     */
    createProject(data: CreateProjectInput): Promise<Project>;
    /**
     * Update existing project
     */
    updateProject(id: string, data: UpdateProjectInput): Promise<Project>;
    /**
     * Delete project
     */
    deleteProject(id: string): Promise<void>;
    /**
     * List tasks (optionally filtered by project)
     */
    listTasks(projectId?: string): Promise<Task[]>;
    /**
     * Get single task by ID
     */
    getTask(id: string): Promise<Task>;
    /**
     * Create new task
     */
    createTask(data: CreateTaskInput): Promise<Task>;
    /**
     * Update existing task
     */
    updateTask(id: string, data: UpdateTaskInput): Promise<Task>;
    /**
     * Delete task
     */
    deleteTask(id: string): Promise<void>;
    /**
     * List all team members
     */
    listTeam(): Promise<TeamMember[]>;
    /**
     * Get team member by ID
     */
    getTeamMember(id: string): Promise<TeamMember>;
    /**
     * List risks (optionally filtered by project)
     */
    listRisks(projectId?: string): Promise<Risk[]>;
    /**
     * Get risk by ID
     */
    getRisk(id: string): Promise<Risk>;
    /**
     * Health check — test API connection
     */
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
    }>;
    /**
     * Find project by name (fuzzy search) with caching
     */
    findProjectByName(name: string): Promise<Project | null>;
}
/**
 * Get default DashboardClient instance
 */
export declare function getDashboardClient(): DashboardClient;
/**
 * Reset default client (useful for testing)
 */
export declare function resetDashboardClient(): void;
//# sourceMappingURL=dashboard-client.d.ts.map