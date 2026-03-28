/**
 * CEOClaw Daemon — Voice Transcription
 *
 * Handles voice message transcription via OpenAI Whisper API.
 * Improved over OpenClaw: uses HTTP API (no local binary needed),
 * supports configurable language and model.
 */

import { createLogger } from "../logger";
import type { VoiceConfig } from "../config";
import { createReadStream, writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const log = createLogger("voice");

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Download a Telegram file by file_id and transcribe it.
 */
export async function transcribeTelegramVoice(
  botToken: string,
  fileId: string,
  voiceConfig: VoiceConfig
): Promise<TranscriptionResult> {
  if (voiceConfig.transcription.provider === "none") {
    throw new Error("Voice transcription is disabled");
  }

  // 1. Get file path from Telegram
  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  const fileInfo = (await fileInfoRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
  };

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error("Failed to get Telegram file info");
  }

  // 2. Download the audio file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
  const audioRes = await fetch(fileUrl);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

  // 3. Save to temp file (Whisper API needs a file)
  const ext = fileInfo.result.file_path.split(".").pop() || "ogg";
  const tempPath = join(tmpdir(), `ceoclaw-voice-${Date.now()}.${ext}`);
  writeFileSync(tempPath, audioBuffer);

  try {
    // 4. Transcribe
    if (voiceConfig.transcription.provider === "whisper-api") {
      return await transcribeWithWhisperAPI(tempPath, voiceConfig);
    } else {
      return await transcribeWithLocalWhisper(tempPath, voiceConfig);
    }
  } finally {
    // 5. Cleanup temp file
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

/**
 * Transcribe using OpenAI Whisper API (cloud).
 */
async function transcribeWithWhisperAPI(
  filePath: string,
  voiceConfig: VoiceConfig
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY required for Whisper API transcription");
  }

  const formData = new FormData();
  const fileBlob = new Blob([createReadStream(filePath) as unknown as BlobPart]);

  // Use the native Node.js file reading for FormData
  const fileBuffer = await import("fs").then((fs) =>
    fs.readFileSync(filePath)
  );
  const blob = new Blob([fileBuffer], { type: "audio/ogg" });
  formData.append("file", blob, `voice.${filePath.split(".").pop()}`);
  formData.append("model", voiceConfig.transcription.model);
  formData.append("language", voiceConfig.transcription.language);
  formData.append("response_format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    voiceConfig.transcription.timeoutSeconds * 1000
  );

  try {
    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as { text: string };
    log.info("Whisper API transcription complete", {
      textLength: result.text.length,
    });

    return { text: result.text, language: voiceConfig.transcription.language };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Transcribe using local Whisper binary (OpenClaw pattern).
 */
async function transcribeWithLocalWhisper(
  filePath: string,
  voiceConfig: VoiceConfig
): Promise<TranscriptionResult> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const args = [
    filePath,
    "--model",
    voiceConfig.transcription.model,
    "--language",
    voiceConfig.transcription.language,
    "--output_format",
    "txt",
  ];

  try {
    const { stdout } = await execFileAsync("whisper", args, {
      timeout: voiceConfig.transcription.timeoutSeconds * 1000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const text = stdout.trim();
    log.info("Local Whisper transcription complete", {
      textLength: text.length,
    });

    return { text, language: voiceConfig.transcription.language };
  } catch (error) {
    throw new Error(
      `Local Whisper failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
