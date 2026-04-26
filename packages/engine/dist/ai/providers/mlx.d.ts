/**
 * MLX Provider — Local LLM inference via mlx-lm
 *
 * Connects to mlx_lm.server running on localhost:8080.
 * OpenAI-compatible /v1/chat/completions API. No API key required.
 */
import type { AIProvider, Message, ChatOptions } from './base';
export declare class MlxProvider implements AIProvider {
    name: string;
    models: string[];
    private baseUrl;
    constructor({ baseUrl }?: {
        baseUrl?: string;
    });
    isAvailable(): Promise<boolean>;
    listModels(): Promise<string[]>;
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}
//# sourceMappingURL=mlx.d.ts.map