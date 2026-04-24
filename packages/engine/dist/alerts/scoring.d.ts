import type { AlertFeed, ExecutiveSnapshot, PrioritizedAlert } from '../briefs/types';
import { type BriefLocale } from '../briefs/locale';
type AlertOptions = {
    projectId?: string;
    limit?: number;
    referenceDate?: string | Date;
    locale?: BriefLocale;
};
type AlertDraft = Omit<PrioritizedAlert, "freshness" | "score">;
export declare function buildAlertFeed(snapshot: ExecutiveSnapshot, options?: AlertOptions): AlertFeed;
export declare function buildPortfolioAlerts(snapshot: ExecutiveSnapshot, options?: Pick<AlertOptions, "locale" | "referenceDate">): PrioritizedAlert[];
export declare function buildProjectAlerts(snapshot: ExecutiveSnapshot, projectId: string, options?: Pick<AlertOptions, "locale" | "referenceDate">): PrioritizedAlert[];
export declare function scoreAlert(draft: AlertDraft, referenceDate?: string | Date): PrioritizedAlert;
export declare function calculateFreshness(detectedAt: string, referenceDate?: string | Date): number;
export declare function summarizeRecommendations(alerts: PrioritizedAlert[], locale?: BriefLocale, limit?: number): string[];
export {};
//# sourceMappingURL=scoring.d.ts.map