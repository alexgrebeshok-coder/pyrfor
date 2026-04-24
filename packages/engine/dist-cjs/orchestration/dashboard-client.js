"use strict";
/**
 * DashboardClient — HTTP client for OpenClaw integration
 *
 * Allows OpenClaw agents to interact with pm-dashboard API
 * via HTTP requests (create/read/update operations)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardClient = exports.DashboardAPIError = void 0;
exports.getDashboardClient = getDashboardClient;
exports.resetDashboardClient = resetDashboardClient;
const project_cache_1 = require("../cache/project-cache");
// API base URL (dashboard server)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
function getDefaultApiKey(env = process.env) {
    const key = env.DASHBOARD_API_KEY?.trim() || null;
    if (!key && env.NODE_ENV !== "production") {
        console.warn("⚠️ DASHBOARD_API_KEY is not set. Dashboard client will not work in production.");
    }
    return key;
}
/**
 * API Error class
 */
class DashboardAPIError extends Error {
    constructor(message, status, endpoint, details) {
        super(message);
        this.status = status;
        this.endpoint = endpoint;
        this.details = details;
        this.name = "DashboardAPIError";
    }
}
exports.DashboardAPIError = DashboardAPIError;
/**
 * DashboardClient — HTTP client for dashboard API
 */
class DashboardClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl || API_BASE_URL;
        this.apiKey = apiKey !== undefined ? apiKey : getDefaultApiKey();
    }
    /**
     * Make authenticated HTTP request
     */
    async request(endpoint, options = {}) {
        // P1-2: Validate API key before making request
        if (!this.apiKey) {
            throw new DashboardAPIError("API key is required. Set DASHBOARD_API_KEY environment variable.", 401, endpoint, { auth: "missing_api_key" });
        }
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
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
                throw new DashboardAPIError(errorData.error || `HTTP ${response.status}`, response.status, endpoint, errorData);
            }
            return await response.json();
        }
        catch (error) {
            if (error instanceof DashboardAPIError) {
                throw error;
            }
            throw new DashboardAPIError(error instanceof Error ? error.message : "Network error", 0, endpoint, error);
        }
    }
    // ============================================
    // PROJECT OPERATIONS
    // ============================================
    /**
     * List all projects
     */
    async listProjects() {
        return this.request("/api/projects");
    }
    /**
     * Get single project by ID
     */
    async getProject(id) {
        return this.request(`/api/projects/${id}`);
    }
    /**
     * Create new project
     */
    async createProject(data) {
        return this.request("/api/projects", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    /**
     * Update existing project
     */
    async updateProject(id, data) {
        return this.request(`/api/projects/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        });
    }
    /**
     * Delete project
     */
    async deleteProject(id) {
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
    async listTasks(projectId) {
        const endpoint = projectId
            ? `/api/tasks?projectId=${projectId}`
            : "/api/tasks";
        return this.request(endpoint);
    }
    /**
     * Get single task by ID
     */
    async getTask(id) {
        return this.request(`/api/tasks/${id}`);
    }
    /**
     * Create new task
     */
    async createTask(data) {
        return this.request("/api/tasks", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    /**
     * Update existing task
     */
    async updateTask(id, data) {
        return this.request(`/api/tasks/${id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        });
    }
    /**
     * Delete task
     */
    async deleteTask(id) {
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
    async listTeam() {
        return this.request("/api/team");
    }
    /**
     * Get team member by ID
     */
    async getTeamMember(id) {
        return this.request(`/api/team/${id}`);
    }
    // ============================================
    // RISKS OPERATIONS
    // ============================================
    /**
     * List risks (optionally filtered by project)
     */
    async listRisks(projectId) {
        const endpoint = projectId
            ? `/api/risks?projectId=${projectId}`
            : "/api/risks";
        return this.request(endpoint);
    }
    /**
     * Get risk by ID
     */
    async getRisk(id) {
        return this.request(`/api/risks/${id}`);
    }
    // ============================================
    // UTILITY METHODS
    // ============================================
    /**
     * Health check — test API connection
     */
    async healthCheck() {
        return this.request("/api/health");
    }
    /**
     * Find project by name (fuzzy search) with caching
     */
    async findProjectByName(name) {
        // Check cache first
        const cached = (0, project_cache_1.getCachedProject)(name);
        if (cached) {
            return cached;
        }
        const projects = await this.listProjects();
        const lowerName = name.toLowerCase();
        // Exact match
        const exactMatch = projects.find((p) => p.name.toLowerCase() === lowerName);
        if (exactMatch) {
            (0, project_cache_1.setCachedProject)(name, exactMatch);
            return exactMatch;
        }
        // Partial match
        const partialMatch = projects.find((p) => p.name.toLowerCase().includes(lowerName));
        if (partialMatch) {
            (0, project_cache_1.setCachedProject)(name, partialMatch);
            return partialMatch;
        }
        return null;
    }
}
exports.DashboardClient = DashboardClient;
// Singleton instance for convenience
let defaultClient = null;
/**
 * Get default DashboardClient instance
 */
function getDashboardClient() {
    if (!defaultClient) {
        defaultClient = new DashboardClient();
    }
    return defaultClient;
}
/**
 * Reset default client (useful for testing)
 */
function resetDashboardClient() {
    defaultClient = null;
}
