/**
 * Memory API - GET/PUT/DELETE by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { prismaMemoryManager, type MemoryEntry } from '@/lib/memory/prisma-memory-manager';

interface RouteParams {
  params: Promise<{ id: string }>;
}

type MemoryUpdatePayload = Partial<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * GET /api/memory/[id] - Get memory by ID
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authorizeRequest(req);
    if (authResult instanceof NextResponse) return authResult;
    const { id } = await params;
    const memory = await prismaMemoryManager.getById(id);

    if (!memory) {
      return NextResponse.json(
        { success: false, error: 'Memory not found or expired' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      memory,
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
 * PUT /api/memory/[id] - Update memory
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authorizeRequest(req);
    if (authResult instanceof NextResponse) return authResult;
    const { id } = await params;
    const body = await req.json();
    const { type, category, key, value, validFrom, validUntil, confidence, source } = body;

    const updates: MemoryUpdatePayload = {};
    if (type) updates.type = type;
    if (category) updates.category = category;
    if (key) updates.key = key;
    if (value !== undefined) updates.value = value;
    if (validFrom) updates.validFrom = new Date(validFrom);
    if (validUntil !== undefined) updates.validUntil = validUntil ? new Date(validUntil) : null;
    if (confidence !== undefined) updates.confidence = confidence;
    if (source) updates.source = source;

    const memory = await prismaMemoryManager.update(id, updates);

    if (!memory) {
      return NextResponse.json(
        { success: false, error: 'Memory not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      memory,
    });
  } catch (error) {
    console.error('[Memory API] PUT error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/memory/[id] - Delete memory
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authorizeRequest(req);
    if (authResult instanceof NextResponse) return authResult;
    const { id } = await params;
    const deleted = await prismaMemoryManager.delete(id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Memory not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    console.error('[Memory API] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
