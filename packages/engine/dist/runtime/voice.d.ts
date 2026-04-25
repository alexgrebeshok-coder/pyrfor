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
 * Transcribe a Telegram voice message using the configured provider.
 *
 * - provider 'openai'  → OpenAI Whisper API (cloud, requires API key)
 * - provider 'local'   → local whisper-cli binary (on-device, no API key)
 * - enabled false      → throws 'voice provider disabled'
 */
export declare function transcribeTelegramVoice(opts: TranscribeTelegramVoiceOpts): Promise<string>;
//# sourceMappingURL=voice.d.ts.map