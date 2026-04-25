/**
 * Runtime HTTP Gateway
 *
 * Thin HTTP server that exposes health/status/chat endpoints for the runtime.
 * Uses Node's built-in `http` module — no framework dependencies.
 */
import type { RuntimeConfig } from './config';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
export interface GatewayDeps {
    config: RuntimeConfig;
    runtime: PyrforRuntime;
    health?: HealthMonitor;
    cron?: CronService;
}
export interface GatewayHandle {
    start(): Promise<void>;
    stop(): Promise<void>;
    readonly port: number;
}
export declare function createRuntimeGateway(deps: GatewayDeps): GatewayHandle;
//# sourceMappingURL=gateway.d.ts.map