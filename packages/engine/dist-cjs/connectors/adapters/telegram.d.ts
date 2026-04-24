import type { ConnectorAdapter } from '../types';
type RuntimeEnv = NodeJS.ProcessEnv;
type TelegramFetch = typeof fetch;
export declare function createTelegramConnector(env?: RuntimeEnv, fetchImpl?: TelegramFetch): ConnectorAdapter;
export {};
//# sourceMappingURL=telegram.d.ts.map