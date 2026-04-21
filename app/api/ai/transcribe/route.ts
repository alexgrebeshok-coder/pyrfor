import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getSTTRouter } from "@/lib/ai/multimodal/stt";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB (OpenAI Whisper upload cap)

/**
 * POST /api/ai/transcribe
 *
 * Accepts `multipart/form-data` with:
 *   - `file` (required)       — audio blob (mp3/wav/m4a/ogg/webm/flac).
 *   - `language` (optional)   — BCP-47 hint.
 *   - `prompt` (optional)     — biases transcription toward known terms.
 *   - `model` (optional)      — provider-specific model override.
 *   - `provider` (optional)   — force a specific STT provider.
 *
 * Returns `{ text, language?, durationSeconds?, provider, model }`.
 * Requires `RUN_AI_ACTIONS` permission — the transcription is not
 * persisted here, callers are expected to feed the text into chat,
 * memory, or video-fact workflows as needed.
 */
export async function POST(req: NextRequest) {
  const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "expected multipart/form-data with a 'file' part" },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid form payload",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "'file' part is required and must be a binary blob" },
      { status: 400 }
    );
  }

  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `audio file exceeds ${MAX_AUDIO_BYTES} bytes limit` },
      { status: 413 }
    );
  }

  const filename =
    (file instanceof File && file.name) || `audio-${Date.now()}.webm`;
  const language = typeof form.get("language") === "string"
    ? (form.get("language") as string)
    : undefined;
  const prompt = typeof form.get("prompt") === "string"
    ? (form.get("prompt") as string)
    : undefined;
  const model = typeof form.get("model") === "string"
    ? (form.get("model") as string)
    : undefined;
  const provider = typeof form.get("provider") === "string"
    ? (form.get("provider") as string)
    : undefined;

  try {
    const router = getSTTRouter();
    const result = await router.transcribe(file, filename, {
      language,
      prompt,
      model,
      provider,
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[api/ai/transcribe] failed", {
      workspaceId: authResult.workspace.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: "Transcription failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
