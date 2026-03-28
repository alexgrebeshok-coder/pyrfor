/**
 * Agent Execute API - Run agents with improvements
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { AgentOrchestrator } from '@/lib/agents/orchestrator';
import { memoryManager, contextBuilder } from '@/lib/memory/memory-manager';
import {
  improvedExecutor,
  smartSelector,
  rateLimiter,
  type AgentExecutionOptions,
} from '@/lib/agents/agent-improvements';

// ============================================
// POST - Execute agent (improved)
// ============================================

export async function POST(req: NextRequest) {
  try {
    // Authentication check
    const authResult = await authorizeRequest(req, {
      permission: "RUN_AI_ACTIONS",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await req.json();
    const { agentId, task, projectId, options } = body;

    // Smart agent selection if not specified
    const selectedAgent = agentId || smartSelector.selectAgent(task);

    // Rate limiting check
    const provider = options?.provider || 'openrouter';
    if (!rateLimiter.canRequest(provider)) {
      const waitTime = rateLimiter.getWaitTime(provider);
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          waitTime,
          retryAfter: Math.ceil(waitTime / 1000),
        },
        { status: 429 }
      );
    }

    // Build context
    contextBuilder.build({ projectId });
    const context = {
      projectId,
      memory: memoryManager.getAll().slice(0, 10),
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    // Execute with improvements
    const executionOptions: AgentExecutionOptions = {
      retry: options?.retry || { maxRetries: 3 },
      fallback: options?.fallback || { enabled: true },
      timeout: options?.timeout || 60000,
      saveToMemory: options?.saveToMemory !== false,
      onProgress: options?.onProgress,
    };

    const result = await improvedExecutor.execute(
      selectedAgent,
      task,
      context,
      executionOptions
    );

    return NextResponse.json({
      success: result.success,
      result: {
        content: result.content,
        data: result.data,
        tokens: result.tokens,
        cost: result.cost,
        duration: result.duration,
        attempts: result.attempts,
        provider: result.provider,
        model: result.model,
      },
      agent: {
        id: selectedAgent,
        capabilities: smartSelector.getAgentCapabilities(selectedAgent),
      },
      timestamp: new Date().toISOString(),
      error: result.error,
    });
  } catch (error) {
    console.error('Agent execute error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// ============================================
// GET - Get agents and stats
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stats = searchParams.get('stats');
    const agentId = searchParams.get('agentId');

    const orchestrator = new AgentOrchestrator();

    if (stats) {
      // Get stats
      const agentStats = await orchestrator.getStats(agentId || undefined);
      return NextResponse.json({ stats: agentStats });
    }

    // Get all agents
    const agents = orchestrator.getAllAgents().map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
    }));

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Agent list error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
