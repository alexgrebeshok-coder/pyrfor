import type { Project, Risk } from '../types/types';
/**
 * Health score for portfolio
 * - overall: 0-100 (overall portfolio health)
 * - budget: 0-100 (average CPI across projects)
 * - schedule: 0-100 (average SPI across projects)
 * - risk: 0-100 (based on open risks count)
 * - resource: 0-100 (based on team utilization)
 */
export interface HealthScore {
    overall: number;
    budget: number;
    schedule: number;
    risk: number;
    resource: number;
}
/**
 * Calculate portfolio health from projects data
 *
 * Formula:
 * - Budget Health = avg(CPI) → 0-100 score
 * - Schedule Health = avg(SPI) → 0-100 score
 * - Risk Health = 100 - (risks_count * weight) → 0-100 score
 * - Resource Health = 100 - (avg_team_utilization - 100 if > 100) → 0-100 score
 * - Overall = (Budget*0.3 + Schedule*0.3 + Risk*0.25 + Resource*0.15)
 */
export declare function calculatePortfolioHealth(projects: Project[], risks: Risk[], teamUtilization: number): HealthScore;
//# sourceMappingURL=health-calculator.d.ts.map