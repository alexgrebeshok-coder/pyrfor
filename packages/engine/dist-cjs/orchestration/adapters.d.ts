/**
 * External Adapter interface + implementations
 *
 * Adapters allow executing agents on external platforms:
 * - internal: uses CEOClaw's own execution engine (default)
 * - openclaw: calls OpenClaw cloud API via SSE
 * - webhook: fires a generic webhook
 * - telegram: sends task via Telegram bot
 */
export interface AdapterResult {
    content: string;
    tokens: number;
    costUsd: number;
    model: string;
    provider: string;
}
export interface ExternalAdapter {
    type: string;
    execute(params: {
        agentId: string;
        prompt: string;
        config: Record<string, unknown>;
        onEvent?: (event: string) => void;
    }): Promise<AdapterResult>;
}
export declare class OpenClawAdapter implements ExternalAdapter {
    readonly type = "openclaw";
    execute(params: {
        agentId: string;
        prompt: string;
        config: Record<string, unknown>;
        onEvent?: (event: string) => void;
    }): Promise<AdapterResult>;
}
export declare class WebhookAdapter implements ExternalAdapter {
    readonly type = "webhook";
    execute(params: {
        agentId: string;
        prompt: string;
        config: Record<string, unknown>;
        onEvent?: (event: string) => void;
    }): Promise<AdapterResult>;
}
export declare function getAdapter(type: string): ExternalAdapter | null;
export declare function registerAdapter(adapter: ExternalAdapter): void;
//# sourceMappingURL=adapters.d.ts.map