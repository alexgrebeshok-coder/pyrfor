/**
 * Base Agent - Abstract base class for all agents
 */

import { AIRouter, Message, getRouter } from '../ai/providers';
import { AgentSessionManager } from './agent-store';

// ============================================
// Types
// ============================================

export interface MemoryItem {
  type: string;
  category: string;
  key: string;
  value: unknown;
  confidence?: number;
  createdAt?: string;
}

type AgentContextMetadata = Record<string, unknown> & {
  toolInstructions?: string;
};

export interface AgentContext {
  projectId?: string;
  projectName?: string;
  tasks?: unknown[];
  risks?: unknown[];
  memory?: MemoryItem[] | { longTerm: MemoryItem[]; recent: MemoryItem[] };
  metadata?: AgentContextMetadata;
}

export interface AgentResult {
  success: boolean;
  content: string;
  data?: unknown;
  tokens?: number;
  cost?: number;
  error?: string;
}

// ============================================
// Base Agent
// ============================================

export abstract class BaseAgent {
  abstract id: string;
  abstract name: string;
  abstract role: string;
  abstract description: string;

  protected model: string;
  protected provider: string;
  protected router: AIRouter;
  protected sessions: AgentSessionManager;

  constructor(config: { model: string; provider: string }) {
    this.model = config.model;
    this.provider = config.provider;
    this.router = getRouter();
    this.sessions = new AgentSessionManager();
  }

  /**
   * Execute agent task
   */
  abstract execute(task: string, context?: AgentContext): Promise<AgentResult>;

  /**
   * Get system prompt for this agent (used for streaming path)
   */
  abstract getSystemPrompt(context?: AgentContext): string;

  protected decorateSystemPrompt(basePrompt: string, context?: AgentContext): string {
    const toolInstructions = context?.metadata?.toolInstructions;
    if (!toolInstructions) {
      return basePrompt;
    }

    return `${basePrompt}\n\n${toolInstructions}`;
  }

  /**
   * Build messages array for direct provider streaming (bypasses execute())
   */
  buildMessages(task: string, context?: AgentContext): Message[] {
    const systemPrompt = this.decorateSystemPrompt(this.getSystemPrompt(context), context);

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];
  }

  /**
   * Expose provider and model for streaming path
   */
  getModel(): string { return this.model; }
  getProvider(): string { return this.provider; }

  /**
   * Chat with AI
   */
  protected async chat(
    systemPrompt: string,
    userMessage: string,
    context?: AgentContext
  ): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: this.decorateSystemPrompt(systemPrompt, context) },
      { role: 'user', content: userMessage },
    ];

    return this.router.chat(messages, {
      model: this.model,
      provider: this.provider,
    });
  }

  /**
   * Run agent with session tracking
   */
  async run(task: string, context?: AgentContext): Promise<AgentResult> {
    // Create session
    const session = await this.sessions.createSession({
      agentId: this.id,
      task,
      model: this.model,
      provider: this.provider,
    });

    try {
      // Start session
      await this.sessions.startSession(session.id);

      // Execute
      const result = await this.execute(task, context);

      // Estimate tokens (rough: 4 chars per token)
      const tokens = Math.ceil((task.length + result.content.length) / 4);
      const cost = this.estimateCost(tokens);

      // Complete session
      await this.sessions.completeSession(
        session.id,
        { content: result.content, data: result.data },
        tokens,
        cost
      );

      return {
        ...result,
        tokens,
        cost,
      };
    } catch (error) {
      // Fail session
      await this.sessions.failSession(
        session.id,
        error instanceof Error ? error.message : 'Unknown error'
      );

      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Estimate cost based on tokens
   */
  private estimateCost(tokens: number): number {
    // Rough estimates per 1K tokens
    const costs: Record<string, number> = {
      'gemini-3.1-flash-lite-preview': 0.00025,
      'glm-5': 0.001,
      'gpt-5.2': 0.005,
    };

    const costPer1K = costs[this.model] || 0.001;
    return (tokens / 1000) * costPer1K;
  }
}
