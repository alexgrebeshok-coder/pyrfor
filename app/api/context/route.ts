/**
 * Context API - Build AI context from memory
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { contextBuilder, type MemoryEntry } from "@/lib/memory/memory-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEMORY_CATEGORIES = new Set<MemoryEntry["category"]>([
  "project",
  "contact",
  "fact",
  "skill",
  "decision",
  "agent",
  "chat",
]);

function isMemoryCategory(value: string | null): value is MemoryEntry["category"] {
  return value !== null && MEMORY_CATEGORIES.has(value as MemoryEntry["category"]);
}

// GET /api/context - Build context for AI
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const authResult = await authorizeRequest(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") || undefined;
    const categoryParam = searchParams.get("category");
    const category = isMemoryCategory(categoryParam) ? categoryParam : undefined;
    const maxTokens = parseInt(searchParams.get("maxTokens") || "1000");

    let context: string;

    if (projectId) {
      context = contextBuilder.buildProjectContext(projectId);
    } else {
      context = contextBuilder.build({ category, maxTokens });
    }

    return NextResponse.json({ context });
  } catch (error) {
    console.error("[Context API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
