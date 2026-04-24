import type { Project, ProjectHealth, PortfolioHealth } from '../types/types';
export type RecommendationType = "critical" | "optimization" | "resource" | "risk-mitigation";
export type RecommendationPriority = "critical" | "warning" | "info";
export interface Recommendation {
    id: string;
    type: RecommendationType;
    priority: RecommendationPriority;
    title: string;
    description: string;
    action: string;
    projectId?: string;
    projectName?: string;
    createdAt: string;
}
/**
 * Generate recommendations based on projects, health, and AI insights
 *
 * Rule-based recommendations engine (no external AI API)
 * Analyzes:
 * - Project health scores
 * - Budget and schedule performance
 * - Resource utilization
 * - Risk levels
 */
export declare function generateRecommendations(projects: Project[], health: ProjectHealth | null, insights: PortfolioHealth | null): Recommendation[];
//# sourceMappingURL=recommendations-engine.d.ts.map