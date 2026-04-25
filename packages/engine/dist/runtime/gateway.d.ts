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
import { GoalStore } from './goal-store';
export interface GatewayDeps {
    config: RuntimeConfig;
    runtime: PyrforRuntime;
    health?: HealthMonitor;
    cron?: CronService;
    /** Optional GoalStore — defaults to ~/.pyrfor */
    goalStore?: GoalStore;
    /** Optional path to approval-settings.json — defaults to ~/.pyrfor/approval-settings.json */
    approvalSettingsPath?: string;
    /** Optional directory for static Mini App files — defaults to telegram/app/ relative to this module */
    staticDir?: string;
    /** Optional directory for IDE static files — defaults to telegram/ide/ relative to this module */
    ideStaticDir?: string;
    /**
     * Override exec timeout for testing. Defaults to DEFAULT_EXEC_TIMEOUT_MS (30 s).
     * Set to a small value (e.g., 2000) in tests that verify the timeout path.
     */
    execTimeoutMs?: number;
}
export interface GatewayHandle {
    start(): Promise<void>;
    stop(): Promise<void>;
    readonly port: number;
}
/**
 * Exec timeout in milliseconds. Exported so tests can override it via
 * the `execTimeoutMs` field in GatewayDeps.
 */
export declare const DEFAULT_EXEC_TIMEOUT_MS = 30000;
export declare function createRuntimeGateway(deps: GatewayDeps): GatewayHandle;
//# sourceMappingURL=gateway.d.ts.map