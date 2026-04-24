export declare const BUILTIN_CONNECTOR_IDS: readonly ["telegram", "email", "gps", "one-c"];
export type BuiltinConnectorId = (typeof BUILTIN_CONNECTOR_IDS)[number];
export type ConnectorId = BuiltinConnectorId | (string & {});
export type ConnectorDirection = "inbound" | "outbound" | "bidirectional";
export type ConnectorStatusLevel = "ok" | "pending" | "degraded";
export type ConnectorSurfaceMethod = "GET" | "POST" | "WEBHOOK";
export type ConnectorProbeExpectation = "status-only" | "json-object" | "json-array" | "json-field";
export interface ConnectorCredentialRequirement {
    envVar: string;
    description: string;
    required?: boolean;
}
export interface ConnectorApiSurface {
    method: ConnectorSurfaceMethod;
    path: string;
    description: string;
}
export interface ConnectorDescriptor {
    id: ConnectorId;
    name: string;
    description: string;
    direction: ConnectorDirection;
    sourceSystem: string;
    operations: string[];
    credentials: ConnectorCredentialRequirement[];
    apiSurface: ConnectorApiSurface[];
    stub: boolean;
}
export interface ConnectorStatus extends ConnectorDescriptor {
    status: ConnectorStatusLevel;
    configured: boolean;
    checkedAt: string;
    message: string;
    missingSecrets: string[];
    metadata?: Record<string, string | number | boolean | null>;
}
export interface ConnectorStatusSummary {
    status: ConnectorStatusLevel;
    total: number;
    configured: number;
    ok: number;
    pending: number;
    degraded: number;
}
export interface ConnectorAdapter extends ConnectorDescriptor {
    getStatus(): Promise<ConnectorStatus>;
}
export interface ConnectorProbeDefinition {
    baseUrlEnvVar: string;
    path?: string;
    method?: Exclude<ConnectorSurfaceMethod, "WEBHOOK">;
    authEnvVar?: string;
    authHeaderName?: string;
    authScheme?: string;
    expectedStatus?: number;
    expectation?: ConnectorProbeExpectation;
    responseField?: string;
    headers?: Record<string, string>;
    body?: unknown;
}
export interface ConnectorManifest extends Omit<ConnectorDescriptor, "id" | "stub"> {
    id: string;
    stub?: boolean;
    probe?: ConnectorProbeDefinition;
}
//# sourceMappingURL=types.d.ts.map