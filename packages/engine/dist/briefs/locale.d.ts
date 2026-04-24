export type BriefLocale = "ru" | "en";
export declare const DEFAULT_BRIEF_LOCALE: BriefLocale;
export declare function resolveBriefLocale(value?: string | null): BriefLocale;
export declare function formatShortDate(value: string, locale?: BriefLocale): string;
export declare function formatCurrency(value: number, currency?: string, locale?: BriefLocale): string;
export declare function formatSignedPercent(value: number, locale?: BriefLocale): string;
export declare function formatList(values: string[], locale?: BriefLocale): string;
export declare function formatProjectStatus(status: string, locale?: BriefLocale): string;
export declare function formatTaskNoun(count: number, locale?: BriefLocale, adjective?: "overdue" | "blocked" | "open"): string;
export declare function formatRiskNoun(count: number, locale?: BriefLocale, adjective?: "open"): string;
export declare function formatProjectNoun(count: number, locale?: BriefLocale): string;
//# sourceMappingURL=locale.d.ts.map