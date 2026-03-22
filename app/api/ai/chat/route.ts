/**
 * AI Chat API - Local Model First, ZAI Fallback
 *
 * Priority: local-model (localhost:8000) → ZAI (glm-5)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { logger } from '@/lib/logger';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const LOCAL_MODEL_URL = 'http://localhost:8000/v1/chat/completions';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const ZAI_API_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const LOCAL_MODEL_TIMEOUT = 10000; // 10 seconds

export async function POST(req: NextRequest) {
  try {
    // Authentication check
    const authResult = await authorizeRequest(req, {
      permission: "RUN_AI_ACTIONS",
    });
    if (authResult instanceof NextResponse) {
      return authResult; // Return error response
    }

    const body = await req.json();
    const { messages } = body;
    
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1]?.content || '';
    
    // Detect query type for model selection
    const isEVM = /SPI|CPI|EVM|BCWS|BCWP|ACWP|освоени|план.*факт/i.test(lastMessage);
    const modelVersion = isEVM ? 'v11' : 'v10';
    
    logger.info(`[AI Chat] Query type: ${isEVM ? 'EVM' : 'general'}, model: ${modelVersion}`);

    // ============================================
    // 1. Try Local Model First (5s timeout)
    // ============================================
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LOCAL_MODEL_TIMEOUT);
      
      const localResponse = await fetch(LOCAL_MODEL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelVersion,
          messages,
          max_tokens: 500,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (localResponse.ok) {
        const data = await localResponse.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (content) {
          logger.info('[AI Chat] ✅ Local model responded');
          return NextResponse.json({
            success: true,
            response: content,
            provider: 'local',
            model: modelVersion,
          });
        }
      }
      
      logger.warn('[AI Chat] Local model failed, falling back to ZAI');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[AI Chat] Local model error: ${errorMsg}, falling back to ZAI`);
    }

    // ============================================
    // 2. Fallback to ZAI (glm-5)
    // ============================================
    if (!ZAI_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'No AI provider available (local model failed, ZAI key missing)',
      }, { status: 503 });
    }

    const zaiResponse = await fetch(ZAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-5',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!zaiResponse.ok) {
      const errorText = await zaiResponse.text();
      logger.error(`[AI Chat] ZAI error: ${zaiResponse.status} - ${errorText}`);
      return NextResponse.json({
        success: false,
        error: `ZAI error: ${zaiResponse.status}`,
      }, { status: 502 });
    }

    const zaiData = await zaiResponse.json();
    const zaiContent = zaiData.choices?.[0]?.message?.content;
    
    if (!zaiContent) {
      return NextResponse.json({
        success: false,
        error: 'Empty response from ZAI',
      }, { status: 502 });
    }

    logger.info('[AI Chat] ✅ ZAI responded');
    return NextResponse.json({
      success: true,
      response: zaiContent,
      provider: 'zai',
      model: 'glm-5',
    });

  } catch (error) {
    logger.error('[AI Chat] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    provider: 'local-first',
    fallback: 'zai',
  });
}
