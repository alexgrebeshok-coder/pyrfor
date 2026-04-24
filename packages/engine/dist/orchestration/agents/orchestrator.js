/**
 * Agent Orchestrator - Coordinates all agents
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
import { MainAgent } from './main-agent';
import { WorkerAgent, ResearchAgent, CoderAgent, WriterAgent, PlannerAgent, ReviewerAgent, } from './worker-agents';
import { getAgentSessionManager } from './agent-store';
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
export function getOrchestrator() {
    if (!_orchestratorInstance) {
        _orchestratorInstance = new AgentOrchestrator();
    }
    return _orchestratorInstance;
}
// ============================================
// Agent Orchestrator
// ============================================
export class AgentOrchestrator {
    constructor() {
        this.agents = new Map();
        this.sessions = getAgentSessionManager();
        this.initializeAgents();
    }
    /**
     * Initialize all agents
     */
    initializeAgents() {
        this.agents.set('main', new MainAgent());
        this.agents.set('main-worker', new WorkerAgent());
        this.agents.set('quick-research', new ResearchAgent());
        this.agents.set('quick-coder', new CoderAgent());
        this.agents.set('writer', new WriterAgent());
        this.agents.set('planner', new PlannerAgent());
        this.agents.set('main-reviewer', new ReviewerAgent());
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
    execute(agentId, task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const agent = this.agents.get(agentId);
            if (!agent) {
                throw new Error(`Agent ${agentId} not found`);
            }
            const startTime = Date.now();
            const result = yield agent.run(task, context);
            const duration = Date.now() - startTime;
            return {
                agentId: agent.id,
                agentName: agent.name,
                result,
                duration,
            };
        });
    }
    /**
     * Execute multiple agents in parallel
     */
    executeParallel(tasks, context) {
        return __awaiter(this, void 0, void 0, function* () {
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
            const results = yield Promise.all(promises);
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
        });
    }
    /**
     * Smart delegation - Main agent decides which worker to use
     */
    smartExecute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // Step 1: Ask Main agent for recommendation
            const mainResult = yield this.execute('main', task, context);
            if (!mainResult.result.success) {
                return mainResult;
            }
            // Step 2: Parse recommendation
            const recommendation = extractRecommendedAgent(mainResult.result);
            // Step 3: Execute recommended agent
            const workerResult = yield this.execute(recommendation, task, context);
            // Step 4: Review result (optional)
            if (workerResult.result.success && ((_a = context === null || context === void 0 ? void 0 : context.metadata) === null || _a === void 0 ? void 0 : _a.review)) {
                const reviewResult = yield this.execute('main-reviewer', `Review this result:\n${workerResult.result.content}`, context);
                return Object.assign(Object.assign({}, workerResult), { result: Object.assign(Object.assign({}, workerResult.result), { data: Object.assign(Object.assign({}, getResultDataObject(workerResult.result)), { review: reviewResult.result.content }) }) });
            }
            return workerResult;
        });
    }
    /**
     * Get agent stats
     */
    getStats(agentId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (agentId) {
                return this.sessions.getAgentStats(agentId);
            }
            // Get stats for all agents
            const stats = {};
            for (const agent of this.agents.values()) {
                stats[agent.id] = yield this.sessions.getAgentStats(agent.id);
            }
            return stats;
        });
    }
    /**
     * Get recent sessions
     */
    getRecentSessions() {
        return __awaiter(this, arguments, void 0, function* (limit = 20) {
            return this.sessions.getRecentSessions(limit);
        });
    }
}
