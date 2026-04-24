export interface DesktopLocalGatewayStatus {
    mode?: "gateway" | "provider" | "mock" | "unavailable";
    gatewayKind?: "local" | "remote" | "missing";
    available: boolean;
    running: boolean;
    port: number | null;
    gateway_url: string | null;
    probe_url: string | null;
    config_path: string | null;
    chat_completions_enabled: boolean;
    token_configured: boolean;
    message: string;
    model_path?: string;
    adapter_path?: string | null;
    python_path?: string | null;
    auto_start?: boolean;
    unavailableReason?: string | null;
}
export interface DesktopLocalGatewayChatResponse {
    content: string;
    gateway_url: string;
    port: number;
    model: string;
}
export declare function getDesktopLocalGatewayStatus(): Promise<DesktopLocalGatewayStatus | null>;
export declare function runDesktopLocalGatewayPrompt(input: {
    prompt: string;
    runId: string;
    sessionKey?: string;
    model?: string;
}): Promise<DesktopLocalGatewayChatResponse>;
//# sourceMappingURL=local-gateway.d.ts.map