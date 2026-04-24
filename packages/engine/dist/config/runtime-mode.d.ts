export type ServerDataMode = "auto" | "demo" | "live";
export type LiveOperatorDataBlockReason = "database_unavailable";
export interface ServerRuntimeState {
    dataMode: ServerDataMode;
    databaseConfigured: boolean;
    healthStatus: "degraded" | "ok";
}
type RuntimeEnv = NodeJS.ProcessEnv;
/**
 * Legacy compatibility for `APP_DATA_MODE`. Production should treat live DB configuration
 * as the source of truth and stop relying on this variable.
 */
export declare function getServerDataMode(env?: RuntimeEnv): ServerDataMode;
export declare function isDatabaseConfigured(env?: RuntimeEnv): boolean;
export declare function shouldServeMockData(): boolean;
export declare function getServerRuntimeState(env?: RuntimeEnv): ServerRuntimeState;
export declare function getLiveOperatorDataBlockReason(runtime: ServerRuntimeState): LiveOperatorDataBlockReason | null;
export declare function canReadLiveOperatorData(runtime: ServerRuntimeState): boolean;
export {};
//# sourceMappingURL=runtime-mode.d.ts.map