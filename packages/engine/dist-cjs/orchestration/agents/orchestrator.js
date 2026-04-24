"use strict";
/**
 * Agent Orchestrator - Coordinates all agents
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOrchestrator = void 0;
exports.getOrchestrator = getOrchestrator;
const main_agent_1 = require("./main-agent");
const worker_agents_1 = require("./worker-agents");
const agent_store_1 = require("./agent-store");
function extractRecommendedAgent(result) {
    const { data } = result;
    if (typeof data === "object" &&
        data !== null &&
        "recommendation" in data &&
        typeof data.recommendation === "string") {
        return data.recommendation;
    }
    return "main-worker";
}
function getResultDataObject(result) {
    const { data } = result;
    if (typeof data === "object" && data !== null) {
        return data;
    }
    return {};
}
// ============================================
// Singleton instance (one per process, not per request)
// ============================================
let _orchestratorInstance = null;
function getOrchestrator() {
    if (!_orchestratorInstance) {
        _orchestratorInstance = new AgentOrchestrator();
    }
    return _orchestratorInstance;
}
// ============================================
// Agent Orchestrator
// ============================================
class AgentOrchestrator {
    constructor() {
        this.agents = new Map();
        this.sessions = (0, agent_store_1.getAgentSessionManager)();
        this.initializeAgents();
    }
    /**
     * Initialize all agents
     */
    initializeAgents() {
        this.agents.set('main', new main_agent_1.MainAgent());
        this.agents.set('main-worker', new worker_agents_1.WorkerAgent());
        this.agents.set('quick-research', new worker_agents_1.ResearchAgent());
        this.agents.set('quick-coder', new worker_agents_1.CoderAgent());
        this.agents.set('writer', new worker_agents_1.WriterAgent());
        this.agents.set('planner', new worker_agents_1.PlannerAgent());
        this.agents.set('main-reviewer', new worker_agents_1.ReviewerAgent());
    }
    /**
     * Get agent by ID
     */
    getAgent(agentId) {
        return this.agents.get(agentId);
    }
    /**
     * Get all agents
     */
    getAllAgents() {
        return Array.from(this.agents.values());
    }
    /**
     * Execute single agent
     */
    async execute(agentId, task, context) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }
        const startTime = Date.now();
        const result = await agent.run(task, context);
        const duration = Date.now() - startTime;
        return {
            agentId: agent.id,
            agentName: agent.name,
            result,
            duration,
        };
    }
    /**
     * Execute multiple agents in parallel
     */
    async executeParallel(tasks, context) {
        const startTime = Date.now();
        // Run all agents in parallel
        const promises = tasks.map((t) => this.execute(t.agentId, t.task, context).catch((error) => ({
            agentId: t.agentId,
            agentName: t.agentId,
            result: {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            duration: 0,
        })));
        const results = await Promise.all(promises);
        const totalDuration = Date.now() - startTime;
        // Calculate totals
        const totalTokens = results.reduce((sum, r) => sum + ('tokens' in r.result ? (r.result.tokens || 0) : 0), 0);
        const totalCost = results.reduce((sum, r) => sum + ('cost' in r.result ? (r.result.cost || 0) : 0), 0);
        return {
            success: results.every((r) => r.result.success),
            results,
            totalDuration,
            totalTokens,
            totalCost,
        };
    }
    /**
     * Smart delegation - Main agent decides which worker to use
     */
    async smartExecute(task, context) {
        // Step 1: Ask Main agent for recommendation
        const mainResult = await this.execute('main', task, context);
        if (!mainResult.result.success) {
            return mainResult;
        }
        // Step 2: Parse recommendation
        const recommendation = extractRecommendedAgent(mainResult.result);
        // Step 3: Execute recommended agent
        const workerResult = await this.execute(recommendation, task, context);
        // Step 4: Review result (optional)
        if (workerResult.result.success && context?.metadata?.review) {
            const reviewResult = await this.execute('main-reviewer', `Review this result:\n${workerResult.result.content}`, context);
            return {
                ...workerResult,
                result: {
                    ...workerResult.result,
                    data: {
                        ...getResultDataObject(workerResult.result),
                        review: reviewResult.result.content,
                    },
                },
            };
        }
        return workerResult;
    }
    /**
     * Get agent stats
     */
    async getStats(agentId) {
        if (agentId) {
            return this.sessions.getAgentStats(agentId);
        }
        // Get stats for all agents
        const stats = {};
        for (const agent of this.agents.values()) {
            stats[agent.id] = await this.sessions.getAgentStats(agent.id);
        }
        return stats;
    }
    /**
     * Get recent sessions
     */
    async getRecentSessions(limit = 20) {
        return this.sessions.getRecentSessions(limit);
    }
}
exports.AgentOrchestrator = AgentOrchestrator;
