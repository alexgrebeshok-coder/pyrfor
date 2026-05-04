import type { ConnectorDescriptor } from './types';
import type { ConnectorRegistry } from './registry';
export interface ConnectorInventoryItem extends ConnectorDescriptor {
    configured: boolean;
    missingSecrets: string[];
    hasProbe: boolean;
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