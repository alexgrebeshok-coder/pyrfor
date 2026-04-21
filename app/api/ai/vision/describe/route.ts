import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getVisionRouter, type ImageSource } from "@/lib/ai/multimodal/vision";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/vision/describe
 *
 * Body (JSON):
 *   {
 *     "image": { "kind": "url", "url": "https://..." }
 *           | { "kind": "base64", "data": "<b64>", "mimeType": "image/png" },
 *     "prompt"?: string,
 *     "language"?: string,
 *     "maxTokens"?: number,
 *     "model"?: string,
 *     "provider"?: string,
 *     "mode"?: "describe" | "verify",
 *     "claim"?: string     // required when mode === "verify"
 *   }
 *
 * Returns the router result verbatim.
 */
export async function POST(req: NextRequest) {
  const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  let body: {
    image?: ImageSource;
    prompt?: string;
    language?: string;
    maxTokens?: number;
    model?: string;
    provider?: string;
    mode?: "describe" | "verify";
    claim?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "expected a JSON body" },
      { status: 400 }
    );
  }

  if (!body.image || !isValidImageSource(body.image)) {
    return NextResponse.json(
      {
        error:
          "'image' must be an object { kind: 'url', url } or { kind: 'base64', data, mimeType }",
      },
      { status: 400 }
    );
  }

  const mode = body.mode ?? "describe";
  if (mode === "verify" && !body.claim) {
    return NextResponse.json(
      { error: "'claim' is required when mode === 'verify'" },
      { status: 400 }
    );
  }

  try {
    const router = getVisionRouter();
    if (mode === "verify") {
      const result = await router.verify(body.image, {
        claim: body.claim!,
        prompt: body.prompt,
        language: body.language,
        maxTokens: body.maxTokens,
        model: body.model,
        provider: body.provider,
      });
      return NextResponse.json(result);
    }

    const result = await router.describe(body.image, {
      prompt: body.prompt,
      language: body.language,
      maxTokens: body.maxTokens,
      model: body.model,
      provider: body.provider,
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[api/ai/vision/describe] failed", {
      workspaceId: authResult.workspace.id,
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: "Vision request failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}

function isValidImageSource(value: unknown): value is ImageSource {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "url") return typeof v.url === "string" && v.url.length > 0;
  if (v.kind === "base64") {
    return typeof v.data === "string" && typeof v.mimeType === "string";
  }
  return false;
}
