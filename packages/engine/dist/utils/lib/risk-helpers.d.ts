/**
 * Risk level utilities shared across analytics components
 */
export declare const RISK_LEVELS: {
    readonly low: {
        readonly threshold: 4;
        readonly label: "Низкий";
        readonly color: "#22c55e";
    };
    readonly medium: {
        readonly threshold: 9;
        readonly label: "Средний";
        readonly color: "#eab308";
    };
    readonly high: {
        readonly threshold: 16;
        readonly label: "Высокий";
        readonly color: "#f97316";
    };
    readonly critical: {
        readonly threshold: 25;
        readonly label: "Критичный";
        readonly color: "#ef4444";
    };
};
export type RiskLevel = keyof typeof RISK_LEVELS;
/**
 * Determine risk level based on severity score (probability × impact)
 */
export declare function getRiskLevel(severity: number): RiskLevel;
/**
 * Get human-readable label for a risk level
 */
export declare function getLevelLabel(level: RiskLevel): string;
/**
 * Get color hex code for a risk level
 */
export declare function getLevelColor(level: RiskLevel): string;
/**
 * Get detailed label with threshold range
 */
export declare function getLevelLabelWithRange(level: RiskLevel): string;
//# sourceMappingURL=risk-helpers.d.ts.map