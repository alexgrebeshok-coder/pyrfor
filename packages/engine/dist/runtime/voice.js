// @vitest-environment node
/**
 * Voice transcription runtime module.
 * Supports OpenAI Whisper API ('openai' provider) and local whisper-cli ('local' provider).
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../observability/logger.js';
// ─── Telegram helpers ────────────────────────────────────────────────────────
function fetchTelegramFileBuffer(botToken, fileId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const metaRes = yield fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        if (!metaRes.ok) {
            throw new Error(`[voice] Telegram getFile failed: ${metaRes.status}`);
        }
        const meta = (yield metaRes.json());
        if (!meta.ok || !((_a = meta.result) === null || _a === void 0 ? void 0 : _a.file_path)) {
            throw new Error('[voice] Failed to get Telegram file info');
        }
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${meta.result.file_path}`;
        const audioRes = yield fetch(fileUrl);
        if (!audioRes.ok) {
            throw new Error(`[voice] Failed to download voice file: ${audioRes.status}`);
        }
        const arrayBuf = yield audioRes.arrayBuffer();
        logger.debug('[voice] downloaded telegram voice', { bytes: arrayBuf.byteLength });
        return { buffer: Buffer.from(arrayBuf), filePath: meta.result.file_path };
    });
}
// ─── Providers ───────────────────────────────────────────────────────────────
function transcribeWithWhisperApi(buffer, voiceConfig, openaiApiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const key = (_a = openaiApiKey !== null && openaiApiKey !== void 0 ? openaiApiKey : voiceConfig.openaiApiKey) !== null && _a !== void 0 ? _a : process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error('[voice] OPENAI_API_KEY required for whisper-api transcription');
        }
        const blob = new Blob([buffer], { type: 'audio/ogg' });
        const formData = new FormData();
        formData.append('file', blob, 'voice.ogg');
        formData.append('model', (_b = voiceConfig.model) !== null && _b !== void 0 ? _b : 'whisper-1');
        formData.append('response_format', 'json');
        if (voiceConfig.language && voiceConfig.language !== 'auto') {
            formData.append('language', voiceConfig.language);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        try {
            const res = yield fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}` },
                body: formData,
                signal: controller.signal,
            });
            if (!res.ok) {
                const errText = yield res.text();
                throw new Error(`[voice] Whisper API error (${res.status}): ${errText}`);
            }
            const result = (yield res.json());
            logger.info('[voice] whisper-api transcription complete', { textLength: result.text.length });
            return result.text;
        }
        finally {
            clearTimeout(timer);
        }
    });
}
function transcribeWithLocalWhisper(buffer, voiceConfig) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const execFileAsync = promisify(execFile);
        const whisperBin = (_b = (_a = voiceConfig.whisperBinary) !== null && _a !== void 0 ? _a : process.env.WHISPER_CLI_PATH) !== null && _b !== void 0 ? _b : '/opt/homebrew/bin/whisper-cli';
        const whisperModel = (_c = process.env.WHISPER_MODEL_PATH) !== null && _c !== void 0 ? _c : path.join(os.homedir(), '.openclaw', 'models', 'whisper', 'ggml-small.bin');
        const ffmpeg = (_d = process.env.FFMPEG_PATH) !== null && _d !== void 0 ? _d : '/opt/homebrew/bin/ffmpeg';
        const tag = `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const tmpOgg = path.join(os.tmpdir(), `${tag}.ogg`);
        const tmpWav = path.join(os.tmpdir(), `${tag}.wav`);
        try {
            // 1. Write downloaded bytes to a temp .ogg
            yield fsp.writeFile(tmpOgg, buffer);
            // 2. Convert to 16kHz mono WAV via ffmpeg
            yield execFileAsync(ffmpeg, ['-y', '-i', tmpOgg, '-ar', '16000', '-ac', '1', tmpWav], {
                timeout: 30000,
            });
            // 3. Transcribe with whisper-cli
            const langArgs = voiceConfig.language && voiceConfig.language !== 'auto'
                ? ['-l', voiceConfig.language]
                : [];
            const { stdout } = yield execFileAsync(whisperBin, ['-m', whisperModel, ...langArgs, '-t', '8', tmpWav], { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
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
        }
        finally {
            // Cleanup temp files — ignore errors
            yield fsp.unlink(tmpOgg).catch(() => undefined);
            yield fsp.unlink(tmpWav).catch(() => undefined);
        }
    });
}
// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Transcribe a Telegram voice message using the configured provider.
 *
 * - provider 'openai'  → OpenAI Whisper API (cloud, requires API key)
 * - provider 'local'   → local whisper-cli binary (on-device, no API key)
 * - enabled false      → throws 'voice provider disabled'
 */
export function transcribeTelegramVoice(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { botToken, fileId, voiceConfig, openaiApiKey } = opts;
        if (!voiceConfig.enabled) {
            throw new Error('[voice] voice provider disabled');
        }
        const { buffer } = yield fetchTelegramFileBuffer(botToken, fileId);
        switch (voiceConfig.provider) {
            case 'openai':
                return transcribeWithWhisperApi(buffer, voiceConfig, openaiApiKey);
            case 'local':
                return transcribeWithLocalWhisper(buffer, voiceConfig);
            default: {
                const _exhaustive = voiceConfig.provider;
                throw new Error(`[voice] unknown provider: ${String(_exhaustive)}`);
            }
        }
    });
}
