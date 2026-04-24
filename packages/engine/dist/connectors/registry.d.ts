import type { ConnectorAdapter, ConnectorStatus, ConnectorStatusSummary } from './types';
type RuntimeEnv = NodeJS.ProcessEnv;
export declare class ConnectorRegistry {
    private readonly connectors;
    register(connector: ConnectorAdapter): this;
    get(id: string): ConnectorAdapter | undefined;
    list(): ConnectorAdapter[];
    getStatus(id: string): Promise<ConnectorStatus | null>;
    getStatuses(): Promise<ConnectorStatus[]>;
}
export declare function createConnectorRegistry(env?: RuntimeEnv): ConnectorRegistry;
export declare function summarizeConnectorStatuses(statuses: ConnectorStatus[]): ConnectorStatusSummary;
export declare function getConnectorRegistry(): ConnectorRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map