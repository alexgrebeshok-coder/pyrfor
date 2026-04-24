import type { ConnectorAdapter } from '../types';
type RuntimeEnv = NodeJS.ProcessEnv;
type OneCFetch = typeof fetch;
export declare function createOneCConnector(env?: RuntimeEnv, fetchImpl?: OneCFetch): ConnectorAdapter;
export {};
//# sourceMappingURL=one-c.d.ts.map