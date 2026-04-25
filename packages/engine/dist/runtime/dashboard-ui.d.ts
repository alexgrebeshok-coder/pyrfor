export declare const DEFAULT_THEME: {
    background: string;
    foreground: string;
    accent: string;
    warn: string;
    error: string;
};
/** Escape a string for safe insertion into HTML text / attribute values. */
export declare function escapeHtml(s: string): string;
export interface DashboardTab {
    id: string;
    label: string;
    sections: Array<{
        type: string;
        [key: string]: unknown;
    }>;
}
export interface DashboardSnapshot {
    tabs: DashboardTab[];
}
export declare function buildDashboardSnapshot(input: {
    uptime?: number;
    sessions?: any[];
    skills?: any[];
    lessons?: any[];
    budget?: any;
    metrics?: any;
    events?: any[];
}): DashboardSnapshot;
export declare function renderDashboardHtml(opts?: {
    title?: string;
    pollMs?: number;
    basePath?: string;
}): string;
export declare const DASHBOARD_HTML: string;
//# sourceMappingURL=dashboard-ui.d.ts.map