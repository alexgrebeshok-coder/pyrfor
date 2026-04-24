import "server-only";
import type { AIChatMessage } from './context-builder';
import type { SupportedAIProvider } from './chat-config';
import type { AIToolCall, AIToolDefinition } from './tools';
export interface AIChatCompletionResult {
    content: string | null;
    model: string;
    provider: SupportedAIProvider;
    toolCalls?: AIToolCall[];
}
interface ChatCompletionInput {
    maxTokens?: number;
    messages: AIChatMessage[];
    model?: string | null;
    providerOrder: SupportedAIProvider[];
    temperature?: number;
    tools?: readonly AIToolDefinition[];
}
export declare function requestAIChatCompletion(input: ChatCompletionInput): Promise<AIChatCompletionResult>;
export declare function createAIChatStream(input: ChatCompletionInput): Promise<{
    provider: SupportedAIProvider;
    model: string;
    stream: AsyncGenerator<string, void, unknown>;
}>;
export {};
//# sourceMappingURL=chat-service.d.ts.map