import type { ConnectorDescriptor, ConnectorProbeExpectation } from './types';
import type { ConnectorRegistry } from './registry';
export type ConnectorReadinessState = 'configured' | 'pending' | 'stub';
export interface ConnectorReadiness {
    state: ConnectorReadinessState;
    reasons: string[];
    nextStep: string;
}
export interface ConnectorProbePreview {
    mode: 'manifest-probe' | 'descriptor-status';
    requiresApproval: true;
    method?: 'GET' | 'POST';
    path?: string;
    baseUrlEnvVar?: string;
    authEnvVar?: string;
    authHeaderName?: string;
    expectedStatus?: number;
    expectation?: ConnectorProbeExpectation;
    requiredEnvVars: string[];
    headerNames: string[];
    bodyConfigured: boolean;
    note: string;
}
export interface ConnectorInventoryItem extends ConnectorDescriptor {
    configured: boolean;
    missingSecrets: string[];
    hasProbe: boolean;
    readiness: ConnectorReadiness;
    probePreview?: ConnectorProbePreview;
    liveProbeSkipped: true;
    statusSource: 'local-config';
}
export interface ConnectorInventorySummary {
    total: number;
    configured: number;
    pending: number;
    stubs: number;
    liveProbeSkipped: number;
}
export interface ConnectorInventorySnapshot {
    checkedAt: string;
    statusSource: 'local-config';
    connectors: ConnectorInventoryItem[];
    summary: ConnectorInventorySummary;
}
type RuntimeEnv = NodeJS.ProcessEnv;
export declare function buildConnectorInventorySnapshot(registry: ConnectorRegistry, env?: RuntimeEnv, now?: () => Date): ConnectorInventorySnapshot;
export {};
//# sourceMappingURL=inventory.d.ts.map