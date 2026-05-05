import { type PermissionClass } from './permission-engine.js';
export interface BrowserQAReadiness {
    checkedAt: string;
    statusSource: 'local-config';
    liveProbeSkipped: true;
    approvalRequired: true;
    status: 'ready' | 'unavailable';
    browserTool: {
        name: 'browser';
        available: boolean;
        actions: string[];
    };
    playwright: {
        packageName: 'playwright';
        installed: boolean;
        chromiumInstalled: boolean;
        installHint: string;
    };
    permission: {
        toolName: 'browser_navigate';
        permissionClass: PermissionClass | null;
        sideEffect: 'network' | null;
    };
    reasons: string[];
    nextStep: string;
}
export interface BrowserQAReadinessOptions {
    resolveModule?: (moduleName: string) => string;
    isChromiumRuntimeInstalled?: (playwrightEntryPath: string | null) => boolean;
    now?: () => Date;
}
export declare function getBrowserQAReadiness(options?: BrowserQAReadinessOptions): BrowserQAReadiness;
//# sourceMappingURL=browser-readiness.d.ts.map