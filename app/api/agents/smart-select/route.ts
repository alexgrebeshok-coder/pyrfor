/**
 * Agent Smart Select API - Auto-select best agent for task
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { smartSelector } from '@/lib/agents/agent-improvements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/agents/smart-select - Select agent for task
export async function POST(req: NextRequest) {
  try {
    // Authentication check
    const authResult = await authorizeRequest(req);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { task } = await req.json();

    if (!task) {
      return NextResponse.json({ error: 'Task required' }, { status: 400 });
    }

    const agentId = smartSelector.selectAgent(task);
    const capabilities = smartSelector.getAgentCapabilities(agentId);

    return NextResponse.json({
      agentId,
      capabilities,
      task,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Smart Select API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
