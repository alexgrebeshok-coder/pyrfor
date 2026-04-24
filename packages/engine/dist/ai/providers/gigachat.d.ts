import type { AIProvider, Message, ChatOptions } from "./base";
export declare class GigaChatProvider implements AIProvider {
    name: string;
    models: string[];
    private clientId;
    private clientSecret;
    private accessToken;
    private tokenExpiresAt;
    constructor(clientId?: string, clientSecret?: string);
    private getToken;
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
}
//# sourceMappingURL=gigachat.d.ts.map