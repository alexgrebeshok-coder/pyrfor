/**
 * Runtime Service Manager — OS-level process supervision.
 *
 * Supports:
 *   - macOS:  LaunchAgent  (launchctl)      ~/Library/LaunchAgents/dev.pyrfor.runtime.plist
 *   - Linux:  systemd user unit             ~/.config/systemd/user/pyrfor-runtime.service
 *
 * Ported from daemon/service.ts; async-first, ESM-native, no execSync.
 */
export interface InstallOptions {
    executablePath: string;
    args?: string[];
    envFile?: string;
    envOverrides?: Record<string, string>;
}
export interface ServiceStatus {
    running: boolean;
    platform: string;
    details?: unknown;
}
export interface ServiceManager {
    install(options: InstallOptions): Promise<void>;
    uninstall(): Promise<void>;
    status(): Promise<ServiceStatus>;
}
export declare function createServiceManager(opts?: {
    workingDir?: string;
}): ServiceManager;
//# sourceMappingURL=service.d.ts.map