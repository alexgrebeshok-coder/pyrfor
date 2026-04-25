export interface DashboardSourceProviders {
    skills?: () => Promise<any[]> | any[];
    autoTools?: () => Promise<any[]> | any[];
    trajectories?: (opts?: {
        limit?: number;
        sinceMs?: number;
    }) => Promise<any[]> | any[];
    patterns?: () => Promise<any[]> | any[];
    costSummary?: () => Promise<any> | any;
    experiments?: () => Promise<any[]> | any[];
    memorySummary?: () => Promise<any> | any;
}
export interface DashboardServerOptions {
    port?: number;
    host?: string;
    basePath?: string;
    authToken?: string;
    providers: DashboardSourceProviders;
    cacheTtlMs?: number;
    clock?: () => number;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}
export interface DashboardServer {
    start(): Promise<{
        url: string;
        port: number;
    }>;
    stop(): Promise<void>;
    url(): string;
    routes(): string[];
    invalidateCache(key?: string): void;
}
export declare function createDashboardServer(opts: DashboardServerOptions): DashboardServer;
//# sourceMappingURL=dashboard-server.d.ts.map