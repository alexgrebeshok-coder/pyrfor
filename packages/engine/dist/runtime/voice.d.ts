/**
 * Voice transcription runtime module.
 * Supports OpenAI Whisper API ('openai' provider) and local whisper-cli ('local' provider).
 */
import type { RuntimeConfig } from './config';
export type VoiceConfig = RuntimeConfig['voice'];
export interface TranscribeTelegramVoiceOpts {
    botToken: string;
    fileId: string;
    voiceConfig: VoiceConfig;
    openaiApiKey?: string;
}
/**
 * Transcribe an arbitrary audio Buffer using the configured voice provider.
 * This is the IDE/HTTP entry point — callers supply the buffer directly
 * (no Telegram download step).
 *
 * - provider 'openai'  → OpenAI Whisper API (cloud, requires API key)
 * - provider 'local'   → local whisper-cli binary (on-device, no API key)
 * - enabled false      → throws '[voice] voice provider disabled'
 */
export declare function transcribeBuffer(buffer: Buffer, voiceConfig: VoiceConfig, openaiApiKey?: string): Promise<string>;
/**
 * Transcribe a Telegram voice message using the configured provider.
 *
 * - provider 'openai'  → OpenAI Whisper API (cloud, requires API key)
 * - provider 'local'   → local whisper-cli binary (on-device, no API key)
 * - enabled false      → throws 'voice provider disabled'
 */
export declare function transcribeTelegramVoice(opts: TranscribeTelegramVoiceOpts): Promise<string>;
//# sourceMappingURL=voice.d.ts.map