/**
 * Ollama Provider — Local LLM inference
 *
 * Connects to Ollama running on localhost:11434.
 * No API key required. Models must be pulled via `ollama pull <model>`.
 */
import type { AIProvider, Message, ChatOptions } from './base';
export declare class OllamaProvider implements AIProvider {
    name: string;
    models: string[];
    private baseUrl;
    constructor(baseUrl?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
    /** Check if Ollama is running */
    isAvailable(): Promise<boolean>;
    /** List available models */
    listModels(): Promise<string[]>;
}
//# sourceMappingURL=ollama.d.ts.map