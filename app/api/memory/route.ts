/**
 * Memory API - GET (list), POST (create)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { prismaMemoryManager } from '@/lib/memory/prisma-memory-manager';

/**
 * GET /api/memory - List all memories
 */
export async function GET(req: NextRequest) {
  try {
    // Authentication check
    const authResult = await authorizeRequest(req);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as 'long_term' | 'episodic' | 'procedural' | null;
    const category = searchParams.get('category') as 'project' | 'contact' | 'skill' | 'fact' | 'decision' | 'agent' | 'chat' | null;
    const limit = parseInt(searchParams.get('limit') || '100');

    const memories = await prismaMemoryManager.getAll({
      type: type || undefined,
      category: category || undefined,
      limit,
    });

    return NextResponse.json({
      success: true,
      count: memories.length,
      memories,
    });
  } catch (error) {
    console.error('[Memory API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/memory - Create new memory
 */
export async function POST(req: NextRequest) {
  try {
    // Authentication check
    const authResult = await authorizeRequest(req);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await req.json();
    const { type, category, key, value, validFrom, validUntil, confidence, source } = body;

    // Validate required fields
    if (!type || !category || !key || value === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: type, category, key, value' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = ['long_term', 'episodic', 'procedural'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate category
    const validCategories = ['project', 'contact', 'skill', 'fact', 'decision', 'agent', 'chat'];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { success: false, error: `Invalid category. Must be one of: ${validCategories.join(', ')}` },
        { status: 400 }
      );
    }

    const memory = await prismaMemoryManager.add({
      type,
      category,
      key,
      value,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      confidence: confidence ?? 100,
      source: source || 'user',
    });

    return NextResponse.json({
      success: true,
      memory,
    });
  } catch (error) {
    console.error('[Memory API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
