import type { Project } from '../types/types';
import type { EVMMetrics } from '../types/types';
import type { AutoRisk } from '../types/types';
export type InsightType = "trend" | "anomaly" | "pattern" | "warning";
export type InsightSeverity = "critical" | "warning" | "info";
export interface AIInsight {
    id: string;
    type: InsightType;
    severity: InsightSeverity;
    title: string;
    description: string;
    projectId?: string;
    detectedAt: string;
}
/**
 * Rule-based AI Insights Generator
 * Generates insights based on projects, EVM metrics, and auto-detected risks
 */
export declare function generateInsights(projects: Project[], evmMetricsMap: Map<string, EVMMetrics>, risksMap: Map<string, AutoRisk[]>): AIInsight[];
//# sourceMappingURL=insights-generator.d.ts.map