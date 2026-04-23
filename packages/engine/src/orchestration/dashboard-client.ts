/**
 * DashboardClient — HTTP client for OpenClaw integration
 *
 * Allows OpenClaw agents to interact with pm-dashboard API
 * via HTTP requests (create/read/update operations)
 */

import type { Project, Task, TeamMember, Risk } from "../types/types";
import { getCachedProject, setCachedProject } from "../cache/project-cache";

// API base URL (dashboard server)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function getDefaultApiKey(env: NodeJS.ProcessEnv = process.env) {
  const key = env.DASHBOARD_API_KEY?.trim() || null;
  if (!key && env.NODE_ENV !== "production") {
    console.warn(
      "⚠️ DASHBOARD_API_KEY is not set. Dashboard client will not work in production."
    );
  }
  return key;
}

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
    start: string; // ISO date string
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
  dueDate?: string; // ISO date string
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
export class DashboardAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "DashboardAPIError";
  }
}

/**
 * DashboardClient — HTTP client for dashboard API
 */
export class DashboardClient {
  private baseUrl: string;
  private apiKey: string | null;

  constructor(baseUrl?: string, apiKey?: string | null) {
    this.baseUrl = baseUrl || API_BASE_URL;
    this.apiKey = apiKey !== undefined ? apiKey : getDefaultApiKey();
  }

  /**
   * Make authenticated HTTP request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // P1-2: Validate API key before making request
    if (!this.apiKey) {
      throw new DashboardAPIError(
        "API key is required. Set DASHBOARD_API_KEY environment variable.",
        401,
        endpoint,
        { auth: "missing_api_key" }
      );
    }

    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new DashboardAPIError(
          errorData.error || `HTTP ${response.status}`,
          response.status,
          endpoint,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof DashboardAPIError) {
        throw error;
      }
      throw new DashboardAPIError(
        error instanceof Error ? error.message : "Network error",
        0,
        endpoint,
        error
      );
    }
  }

  // ============================================
  // PROJECT OPERATIONS
  // ============================================

  /**
   * List all projects
   */
  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("/api/projects");
  }

  /**
   * Get single project by ID
   */
  async getProject(id: string): Promise<Project> {
    return this.request<Project>(`/api/projects/${id}`);
  }

  /**
   * Create new project
   */
  async createProject(data: CreateProjectInput): Promise<Project> {
    return this.request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Update existing project
   */
  async updateProject(id: string, data: UpdateProjectInput): Promise<Project> {
    return this.request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete project
   */
  async deleteProject(id: string): Promise<void> {
    await this.request(`/api/projects/${id}`, {
      method: "DELETE",
    });
  }

  // ============================================
  // TASK OPERATIONS
  // ============================================

  /**
   * List tasks (optionally filtered by project)
   */
  async listTasks(projectId?: string): Promise<Task[]> {
    const endpoint = projectId
      ? `/api/tasks?projectId=${projectId}`
      : "/api/tasks";
    return this.request<Task[]>(endpoint);
  }

  /**
   * Get single task by ID
   */
  async getTask(id: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${id}`);
  }

  /**
   * Create new task
   */
  async createTask(data: CreateTaskInput): Promise<Task> {
    return this.request<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Update existing task
   */
  async updateTask(id: string, data: UpdateTaskInput): Promise<Task> {
    return this.request<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete task
   */
  async deleteTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}`, {
      method: "DELETE",
    });
  }

  // ============================================
  // TEAM OPERATIONS
  // ============================================

  /**
   * List all team members
   */
  async listTeam(): Promise<TeamMember[]> {
    return this.request<TeamMember[]>("/api/team");
  }

  /**
   * Get team member by ID
   */
  async getTeamMember(id: string): Promise<TeamMember> {
    return this.request<TeamMember>(`/api/team/${id}`);
  }

  // ============================================
  // RISKS OPERATIONS
  // ============================================

  /**
   * List risks (optionally filtered by project)
   */
  async listRisks(projectId?: string): Promise<Risk[]> {
    const endpoint = projectId
      ? `/api/risks?projectId=${projectId}`
      : "/api/risks";
    return this.request<Risk[]>(endpoint);
  }

  /**
   * Get risk by ID
   */
  async getRisk(id: string): Promise<Risk> {
    return this.request<Risk>(`/api/risks/${id}`);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Health check — test API connection
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request("/api/health");
  }

  /**
   * Find project by name (fuzzy search) with caching
   */
  async findProjectByName(name: string): Promise<Project | null> {
    // Check cache first
    const cached = getCachedProject(name);
    if (cached) {
    return cached;
  }

    const projects = await this.listProjects();
    const lowerName = name.toLowerCase();

    // Exact match
    const exactMatch = projects.find(
      (p) => p.name.toLowerCase() === lowerName
    );
    if (exactMatch) {
    setCachedProject(name, exactMatch);
    return exactMatch;
  }

    // Partial match
    const partialMatch = projects.find((p) =>
      p.name.toLowerCase().includes(lowerName)
    );

    if (partialMatch) {
      setCachedProject(name, partialMatch);
      return partialMatch;
    }

    return null;
  }
}

// Singleton instance for convenience
let defaultClient: DashboardClient | null = null;

/**
 * Get default DashboardClient instance
 */
export function getDashboardClient(): DashboardClient {
  if (!defaultClient) {
    defaultClient = new DashboardClient();
  }
  return defaultClient;
}

/**
 * Reset default client (useful for testing)
 */
export function resetDashboardClient(): void {
  defaultClient = null;
}
