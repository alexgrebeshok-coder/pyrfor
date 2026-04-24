import type { AIProvider, Message, ChatOptions } from "./base";
declare function getCachedIPv4(hostname: string): Promise<string>;
export { getCachedIPv4 };
export declare class OpenRouterProvider implements AIProvider {
    name: string;
    models: string[];
    private apiKey;
    constructor(apiKey?: string);
    private httpsPost;
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    /** Stream tokens from OpenRouter as an async generator */
    chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
    /** Inner streaming method for a single model (used by chatStream fallback) */
    private _streamModel;
    /** Merge system messages into the first user message for models that don't support system role */
    private mergeSystemIntoUser;
}
