import type { ConnectorAdapter } from '../types';
import { type EmailTransportFactory } from '../email-client';
type RuntimeEnv = NodeJS.ProcessEnv;
export declare function createEmailConnector(env?: RuntimeEnv, transportFactory?: EmailTransportFactory): ConnectorAdapter;
export {};
//# sourceMappingURL=email.d.ts.map