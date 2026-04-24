import type { AIProvider, Message, ChatOptions } from "./base";
export declare class YandexGPTProvider implements AIProvider {
    name: string;
    models: string[];
    private apiKey;
    private folderId;
    constructor(apiKey?: string, folderId?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
}
//# sourceMappingURL=yandexgpt.d.ts.map