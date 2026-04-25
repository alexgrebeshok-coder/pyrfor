/**
 * DashboardClient — HTTP client for OpenClaw integration
 *
 * Allows OpenClaw agents to interact with pm-dashboard API
 * via HTTP requests (create/read/update operations)
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
import { getCachedProject, setCachedProject } from "../cache/project-cache.js";
// API base URL (dashboard server)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
function getDefaultApiKey(env = process.env) {
    var _a;
    const key = ((_a = env.DASHBOARD_API_KEY) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    if (!key && env.NODE_ENV !== "production") {
        console.warn("⚠️ DASHBOARD_API_KEY is not set. Dashboard client will not work in production.");
    }
    return key;
}
/**
 * API Error class
 */
export class DashboardAPIError extends Error {
    constructor(message, status, endpoint, details) {
        super(message);
        this.status = status;
        this.endpoint = endpoint;
        this.details = details;
        this.name = "DashboardAPIError";
    }
}
/**
 * DashboardClient — HTTP client for dashboard API
 */
export class DashboardClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl || API_BASE_URL;
        this.apiKey = apiKey !== undefined ? apiKey : getDefaultApiKey();
    }
    /**
     * Make authenticated HTTP request
     */
    request(endpoint_1) {
        return __awaiter(this, arguments, void 0, function* (endpoint, options = {}) {
            // P1-2: Validate API key before making request
            if (!this.apiKey) {
                throw new DashboardAPIError("API key is required. Set DASHBOARD_API_KEY environment variable.", 401, endpoint, { auth: "missing_api_key" });
            }
            const url = `${this.baseUrl}${endpoint}`;
            const headers = Object.assign({ "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` }, options.headers);
            try {
                const response = yield fetch(url, Object.assign(Object.assign({}, options), { headers }));
                if (!response.ok) {
                    const errorData = yield response.json().catch(() => ({}));
                    throw new DashboardAPIError(errorData.error || `HTTP ${response.status}`, response.status, endpoint, errorData);
                }
                return yield response.json();
            }
            catch (error) {
                if (error instanceof DashboardAPIError) {
                    throw error;
                }
                throw new DashboardAPIError(error instanceof Error ? error.message : "Network error", 0, endpoint, error);
            }
        });
    }
    // ============================================
    // PROJECT OPERATIONS
    // ============================================
    /**
     * List all projects
     */
    listProjects() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request("/api/projects");
        });
    }
    /**
     * Get single project by ID
     */
    getProject(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request(`/api/projects/${id}`);
        });
    }
    /**
     * Create new project
     */
    createProject(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request("/api/projects", {
                method: "POST",
                body: JSON.stringify(data),
            });
        });
    }
    /**
     * Update existing project
     */
    updateProject(id, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request(`/api/projects/${id}`, {
                method: "PATCH",
                body: JSON.stringify(data),
            });
        });
    }
    /**
     * Delete project
     */
    deleteProject(id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.request(`/api/projects/${id}`, {
                method: "DELETE",
            });
        });
    }
    // ============================================
    // TASK OPERATIONS
    // ============================================
    /**
     * List tasks (optionally filtered by project)
     */
    listTasks(projectId) {
        return __awaiter(this, void 0, void 0, function* () {
            const endpoint = projectId
                ? `/api/tasks?projectId=${projectId}`
                : "/api/tasks";
            return this.request(endpoint);
        });
    }
    /**
     * Get single task by ID
     */
    getTask(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request(`/api/tasks/${id}`);
        });
    }
    /**
     * Create new task
     */
    createTask(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request("/api/tasks", {
                method: "POST",
                body: JSON.stringify(data),
            });
        });
    }
    /**
     * Update existing task
     */
    updateTask(id, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request(`/api/tasks/${id}`, {
                method: "PATCH",
                body: JSON.stringify(data),
            });
        });
    }
    /**
     * Delete task
     */
    deleteTask(id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.request(`/api/tasks/${id}`, {
                method: "DELETE",
            });
        });
    }
    // ============================================
    // TEAM OPERATIONS
    // ============================================
    /**
     * List all team members
     */
    listTeam() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request("/api/team");
        });
    }
    /**
     * Get team member by ID
     */
    getTeamMember(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request(`/api/team/${id}`);
        });
    }
    // ============================================
    // RISKS OPERATIONS
    // ============================================
    /**
     * List risks (optionally filtered by project)
     */
    listRisks(projectId) {
        return __awaiter(this, void 0, void 0, function* () {
            const endpoint = projectId
                ? `/api/risks?projectId=${projectId}`
                : "/api/risks";
            return this.request(endpoint);
        });
    }
    /**
     * Get risk by ID
     */
    getRisk(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request(`/api/risks/${id}`);
        });
    }
    // ============================================
    // UTILITY METHODS
    // ============================================
    /**
     * Health check — test API connection
     */
    healthCheck() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.request("/api/health");
        });
    }
    /**
     * Find project by name (fuzzy search) with caching
     */
    findProjectByName(name) {
        return __awaiter(this, void 0, void 0, function* () {
            // Check cache first
            const cached = getCachedProject(name);
            if (cached) {
                return cached;
            }
            const projects = yield this.listProjects();
            const lowerName = name.toLowerCase();
            // Exact match
            const exactMatch = projects.find((p) => p.name.toLowerCase() === lowerName);
            if (exactMatch) {
                setCachedProject(name, exactMatch);
                return exactMatch;
            }
            // Partial match
            const partialMatch = projects.find((p) => p.name.toLowerCase().includes(lowerName));
            if (partialMatch) {
                setCachedProject(name, partialMatch);
                return partialMatch;
            }
            return null;
        });
    }
}
// Singleton instance for convenience
let defaultClient = null;
/**
 * Get default DashboardClient instance
 */
export function getDashboardClient() {
    if (!defaultClient) {
        defaultClient = new DashboardClient();
    }
    return defaultClient;
}
/**
 * Reset default client (useful for testing)
 */
export function resetDashboardClient() {
    defaultClient = null;
}
