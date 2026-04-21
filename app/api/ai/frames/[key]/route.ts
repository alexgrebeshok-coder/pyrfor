/**
 * GET /api/ai/frames/:key
 *
 * Serves a cached video keyframe (JPEG) by its stable cache key so
 * reviewers can replay the exact frames a vision classifier saw when
 * verifying a video fact. Entries live in-process for ~10 minutes
 * (see `lib/ai/multimodal/frame-cache.ts`); stale keys return 404 so
 * callers know they need to re-trigger extraction.
 *
 * Scope guard: `RUN_AI_ACTIONS` permission. The cache contains
 * frames from workspace-owned evidence and should stay behind auth.
 */

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getCachedFrame } from "@/lib/ai/multimodal/frame-cache";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const authResult = await authorizeRequest(req, {
    permission: "RUN_AI_ACTIONS",
  });
  if (authResult instanceof NextResponse) return authResult;

  const { key } = await params;
  if (!key || !/^[a-f0-9]{8,64}$/i.test(key)) {
    return NextResponse.json(
      { error: "Invalid cache key" },
      { status: 400 }
    );
  }

  const entry = getCachedFrame(key);
  if (!entry) {
    return NextResponse.json(
      { error: "Frame expired or not cached" },
      { status: 404 }
    );
  }

  try {
    const buffer = Buffer.from(entry.data, "base64");
    const headers = new Headers();
    headers.set("content-type", entry.mimeType);
    headers.set("content-length", String(buffer.byteLength));
    headers.set(
      "cache-control",
      // The cache is in-memory with a short TTL — downstream proxies
      // should never store this longer than the server itself would.
      `private, max-age=${Math.max(1, Math.floor((entry.expiresAt - Date.now()) / 1000))}`
    );
    headers.set("x-frame-timestamp", String(entry.timestampSeconds));
    return new NextResponse(buffer, { status: 200, headers });
  } catch (err) {
    logger.error("[api/ai/frames] failed to serve cached frame", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to read cached frame" },
      { status: 500 }
    );
  }
}
