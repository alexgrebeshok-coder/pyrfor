import type { ConnectorAdapter } from '../types';
type RuntimeEnv = NodeJS.ProcessEnv;
type GpsFetch = typeof fetch;
export declare function createGpsConnector(env?: RuntimeEnv, fetchImpl?: GpsFetch): ConnectorAdapter;
export {};
//# sourceMappingURL=gps.d.ts.map