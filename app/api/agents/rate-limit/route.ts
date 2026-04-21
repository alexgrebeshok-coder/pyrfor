/**
 * Agent Rate Limit API - Check rate limits
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter } from '@/lib/agents/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agents/rate-limit - Get rate limit status
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider') || 'openrouter';

    const canRequest = rateLimiter.canRequest(provider);
    const waitTime = rateLimiter.getWaitTime(provider);

    return NextResponse.json({
      provider,
      canRequest,
      waitTime,
      retryAfter: waitTime > 0 ? Math.ceil(waitTime / 1000) : 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Rate Limit API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
