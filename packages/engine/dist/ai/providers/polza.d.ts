import type { AIProvider, Message, ChatOptions } from "./base";
export declare class PolzaProvider implements AIProvider {
    name: string;
    models: string[];
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
}
//# sourceMappingURL=polza.d.ts.map