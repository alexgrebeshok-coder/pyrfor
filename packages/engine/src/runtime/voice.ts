// @vitest-environment node
/**
 * Voice transcription runtime module.
 * Supports OpenAI Whisper API ('openai' provider) and local whisper-cli ('local' provider).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../observability/logger';
import type { RuntimeConfig } from './config';

export type VoiceConfig = RuntimeConfig['voice'];

export interface TranscribeTelegramVoiceOpts {
  botToken: string;
  fileId: string;
  voiceConfig: VoiceConfig;
  openaiApiKey?: string;
}

// ─── Telegram helpers ────────────────────────────────────────────────────────

async function fetchTelegramFileBuffer(
  botToken: string,
  fileId: string,
): Promise<{ buffer: Buffer; filePath: string }> {
  const metaRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
  );
  if (!metaRes.ok) {
    throw new Error(`[voice] Telegram getFile failed: ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path: string } };
  if (!meta.ok || !meta.result?.file_path) {
    throw new Error('[voice] Failed to get Telegram file info');
  }

  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${meta.result.file_path}`;
  const audioRes = await fetch(fileUrl);
  if (!audioRes.ok) {
    throw new Error(`[voice] Failed to download voice file: ${audioRes.status}`);
  }

  const arrayBuf = await audioRes.arrayBuffer();
  logger.debug('[voice] downloaded telegram voice', { bytes: arrayBuf.byteLength });
  return { buffer: Buffer.from(arrayBuf), filePath: meta.result.file_path };
}

// ─── Providers ───────────────────────────────────────────────────────────────

async function transcribeWithWhisperApi(
  buffer: Buffer,
  voiceConfig: VoiceConfig,
  openaiApiKey?: string,
): Promise<string> {
  const key = openaiApiKey ?? voiceConfig.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('[voice] OPENAI_API_KEY required for whisper-api transcription');
  }

  const blob = new Blob([buffer as unknown as BlobPart], { type: 'audio/ogg' });
  const formData = new FormData();
  formData.append('file', blob, 'voice.ogg');
  formData.append('model', voiceConfig.model ?? 'whisper-1');
  formData.append('response_format', 'json');
  if (voiceConfig.language && voiceConfig.language !== 'auto') {
    formData.append('language', voiceConfig.language);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[voice] Whisper API error (${res.status}): ${errText}`);
    }

    const result = (await res.json()) as { text: string };
    logger.info('[voice] whisper-api transcription complete', { textLength: result.text.length });
    return result.text;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeWithLocalWhisper(
  buffer: Buffer,
  voiceConfig: VoiceConfig,
): Promise<string> {
  const execFileAsync = promisify(execFile);
  const whisperBin =
    voiceConfig.whisperBinary ??
    process.env.WHISPER_CLI_PATH ??
    '/opt/homebrew/bin/whisper-cli';
  const whisperModel =
    process.env.WHISPER_MODEL_PATH ??
    path.join(os.homedir(), '.openclaw', 'models', 'whisper', 'ggml-small.bin');
  const ffmpeg = process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';

  const tag = `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpOgg = path.join(os.tmpdir(), `${tag}.ogg`);
  const tmpWav = path.join(os.tmpdir(), `${tag}.wav`);

  try {
    // 1. Write downloaded bytes to a temp .ogg
    await fsp.writeFile(tmpOgg, buffer);

    // 2. Convert to 16kHz mono WAV via ffmpeg
    await execFileAsync(ffmpeg, ['-y', '-i', tmpOgg, '-ar', '16000', '-ac', '1', tmpWav], {
      timeout: 30_000,
    });

    // 3. Transcribe with whisper-cli
    const langArgs =
      voiceConfig.language && voiceConfig.language !== 'auto'
        ? ['-l', voiceConfig.language]
        : [];
    const { stdout } = await execFileAsync(
      whisperBin,
      ['-m', whisperModel, ...langArgs, '-t', '8', tmpWav],
      { timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
    );

    // 4. Parse timestamp lines: [00:00:00.000 --> 00:00:03.000]  text
    const text = stdout
      .split('\n')
      .map((line) => {
        const m = line.match(/\]\s+(.+)/);
        return m ? m[1].trim() : '';
      })
      .filter((t) => t.length > 0)
      .join(' ');

    logger.info('[voice] whisper-local transcription complete', { textLength: text.length });
    return text;
  } finally {
    // Cleanup temp files — ignore errors
    await fsp.unlink(tmpOgg).catch(() => undefined);
    await fsp.unlink(tmpWav).catch(() => undefined);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Transcribe an arbitrary audio Buffer using the configured voice provider.
 * This is the IDE/HTTP entry point — callers supply the buffer directly
 * (no Telegram download step).
 *
 * - provider 'openai'  → OpenAI Whisper API (cloud, requires API key)
 * - provider 'local'   → local whisper-cli binary (on-device, no API key)
 * - enabled false      → throws '[voice] voice provider disabled'
 */
export async function transcribeBuffer(
  buffer: Buffer,
  voiceConfig: VoiceConfig,
  openaiApiKey?: string,
): Promise<string> {
  if (!voiceConfig.enabled) {
    throw new Error('[voice] voice provider disabled');
  }

  switch (voiceConfig.provider) {
    case 'openai':
      return transcribeWithWhisperApi(buffer, voiceConfig, openaiApiKey);
    case 'local':
      return transcribeWithLocalWhisper(buffer, voiceConfig);
    default: {
      const _exhaustive: never = voiceConfig.provider;
      throw new Error(`[voice] unknown provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Transcribe a Telegram voice message using the configured provider.
 *
 * - provider 'openai'  → OpenAI Whisper API (cloud, requires API key)
 * - provider 'local'   → local whisper-cli binary (on-device, no API key)
 * - enabled false      → throws 'voice provider disabled'
 */
export async function transcribeTelegramVoice(
  opts: TranscribeTelegramVoiceOpts,
): Promise<string> {
  const { botToken, fileId, voiceConfig, openaiApiKey } = opts;

  if (!voiceConfig.enabled) {
    throw new Error('[voice] voice provider disabled');
  }

  const { buffer } = await fetchTelegramFileBuffer(botToken, fileId);

  switch (voiceConfig.provider) {
    case 'openai':
      return transcribeWithWhisperApi(buffer, voiceConfig, openaiApiKey);
    case 'local':
      return transcribeWithLocalWhisper(buffer, voiceConfig);
    default: {
      const _exhaustive: never = voiceConfig.provider;
      throw new Error(`[voice] unknown provider: ${String(_exhaustive)}`);
    }
  }
}
