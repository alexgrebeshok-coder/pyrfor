/**
 * Agent Orchestrator - Coordinates all agents
 */

import { BaseAgent, AgentContext, AgentResult } from './base-agent';
import { MainAgent } from './main-agent';
import {
  WorkerAgent,
  ResearchAgent,
  CoderAgent,
  WriterAgent,
  PlannerAgent,
  ReviewerAgent,
} from './worker-agents';
import { AgentSessionManager } from './agent-store';

// ============================================
// Types
// ============================================

export interface OrchestratorResult {
  agentId: string;
  agentName: string;
  result: AgentResult;
  duration: number;
}

export interface ParallelResult {
  success: boolean;
  results: OrchestratorResult[];
  totalDuration: number;
  totalTokens: number;
  totalCost: number;
}

// ============================================
// Singleton instance (one per process, not per request)
// ============================================

let _orchestratorInstance: AgentOrchestrator | null = null;

export function getOrchestrator(): AgentOrchestrator {
  if (!_orchestratorInstance) {
    _orchestratorInstance = new AgentOrchestrator();
  }
  return _orchestratorInstance;
}

// ============================================
// Agent Orchestrator
// ============================================

export class AgentOrchestrator {
  private agents: Map<string, BaseAgent> = new Map();
  private sessions: AgentSessionManager;

  constructor() {
    this.sessions = new AgentSessionManager();
    this.initializeAgents();
  }

  /**
   * Initialize all agents
   */
  private initializeAgents() {
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
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Execute single agent
   */
  async execute(
    agentId: string,
    task: string,
    context?: AgentContext
  ): Promise<OrchestratorResult> {
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
  async executeParallel(
    tasks: { agentId: string; task: string }[],
    context?: AgentContext
  ): Promise<ParallelResult> {
    const startTime = Date.now();

    // Run all agents in parallel
    const promises = tasks.map((t) =>
      this.execute(t.agentId, t.task, context).catch((error) => ({
        agentId: t.agentId,
        agentName: t.agentId,
        result: {
          success: false,
          content: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        duration: 0,
      }))
    );

    const results = await Promise.all(promises);
    const totalDuration = Date.now() - startTime;

    // Calculate totals
    const totalTokens = results.reduce(
      (sum, r) => sum + ('tokens' in r.result ? (r.result.tokens || 0) : 0),
      0
    );
    const totalCost = results.reduce(
      (sum, r) => sum + ('cost' in r.result ? (r.result.cost || 0) : 0),
      0
    );

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
  async smartExecute(
    task: string,
    context?: AgentContext
  ): Promise<OrchestratorResult> {
    // Step 1: Ask Main agent for recommendation
    const mainResult = await this.execute('main', task, context);

    if (!mainResult.result.success) {
      return mainResult;
    }

    // Step 2: Parse recommendation
    const recommendation = mainResult.result.data?.recommendation || 'main-worker';

    // Step 3: Execute recommended agent
    const workerResult = await this.execute(recommendation, task, context);

    // Step 4: Review result (optional)
    if (workerResult.result.success && context?.metadata?.review) {
      const reviewResult = await this.execute(
        'main-reviewer',
        `Review this result:\n${workerResult.result.content}`,
        context
      );

      return {
        ...workerResult,
        result: {
          ...workerResult.result,
          data: {
            ...workerResult.result.data,
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
  async getStats(agentId?: string) {
    if (agentId) {
      return this.sessions.getAgentStats(agentId);
    }

    // Get stats for all agents
    const stats: Record<string, any> = {};

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
