/**
 * Zhipu AI (api.z.ai) — Chinese AI provider.
 * Direct API access, separate from ZukiJourney proxy.
 */
import type { AIProvider, Message, ChatOptions } from './base';
export declare class ZhipuProvider implements AIProvider {
    name: string;
    models: string[];
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}
