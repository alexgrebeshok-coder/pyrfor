import type { ChatOptions, Message } from './providers';
type RuntimeEnv = NodeJS.ProcessEnv;
export declare const AI_PROVIDER_MANIFESTS_ENV = "CEOCLAW_AI_PROVIDER_MANIFESTS";
export interface AIProviderManifest {
    name: string;
    baseURL: string;
    apiKeyEnvVar: string;
    defaultModel: string;
    models?: string[];
    displayName?: string;
    description?: string;
    timeoutMs?: number;
}
export interface AIProviderManifestProvider {
    name: string;
    models: string[];
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}
export declare function loadConfiguredAIProviderManifests(env?: RuntimeEnv): AIProviderManifest[];
export declare function createConfiguredAIProvider(manifest: AIProviderManifest, env?: RuntimeEnv): AIProviderManifestProvider;
export {};
//# sourceMappingURL=provider-manifests.d.ts.map