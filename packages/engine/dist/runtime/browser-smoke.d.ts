import { type BrowserController, type BrowserLauncher } from './browser-control';
export interface BrowserSmokeAssertionInput {
    selector?: string;
    containsText?: string;
}
export interface BrowserSmokeInput {
    url: string;
    assertion?: BrowserSmokeAssertionInput;
    fullPage?: boolean;
    approvalId?: string;
    notes?: string[];
}
export interface NormalizedBrowserSmokeInput {
    url: string;
    publicUrl: string;
    host: string;
    path: string;
    urlHash: string;
    fullPage: boolean;
    assertion?: {
        selector?: string;
        containsText?: string;
        containsTextHash?: string;
    };
    assertionHash: string;
    notes: string[];
}
export interface BrowserSmokeEffect {
    kind: 'browser_smoke';
    approvalId: string;
    executedAt: string;
    targetUrlHash: string;
    finalUrlHash: string;
}
export interface BrowserSmokeSnapshot {
    schemaVersion: 'pyrfor.browser_smoke.v1';
    createdAt: string;
    runId: string;
    status: 'passed' | 'failed';
    sourceMode: 'governed_browser_smoke';
    targetUrlHash: string;
    targetHost: string;
    targetPathHash: string;
    finalHost: string;
    finalUrlHash: string;
    title: string;
    assertion?: {
        selector?: string;
        containsTextHash?: string;
        matched: boolean;
    };
    screenshot: {
        artifactId: string;
        sha256?: string;
        bytes?: number;
        createdAt?: string;
    };
    effectsExecuted: [BrowserSmokeEffect];
    notes: string[];
}
export interface BrowserSmokeCaptureResult {
    normalized: NormalizedBrowserSmokeInput;
    snapshot: Omit<BrowserSmokeSnapshot, 'screenshot'>;
    screenshot: Buffer;
}
export interface RunBrowserSmokeCaptureOptions {
    launcher?: BrowserLauncher;
    controller?: BrowserController;
    now?: () => Date;
}
export declare function normalizeBrowserSmokeInput(input: BrowserSmokeInput): NormalizedBrowserSmokeInput;
export declare function buildBrowserSmokeApprovalId(input: NormalizedBrowserSmokeInput, runId: string): string;
export declare function runBrowserSmokeCapture(runId: string, input: BrowserSmokeInput & {
    approvalId: string;
}, options?: RunBrowserSmokeCaptureOptions): Promise<BrowserSmokeCaptureResult>;
//# sourceMappingURL=browser-smoke.d.ts.map