import type { AIProvider, Message, ChatOptions } from "./base";
export declare class OpenAIProvider implements AIProvider {
    name: string;
    models: string[];
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
}
//# sourceMappingURL=openai.d.ts.map