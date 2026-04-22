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
export function calculatePortfolioHealth(
  projects: Project[],
  risks: Risk[],
  teamUtilization: number
): HealthScore {
  if (projects.length === 0) {
    return {
      overall: 0,
      budget: 0,
      schedule: 0,
      risk: 100,
      resource: 100,
    };
  }

  // Calculate CPI and SPI for each project
  const cpiScores: number[] = [];
  const spiScores: number[] = [];

  projects.forEach((project) => {
    const metrics = calculateProjectEVM(project);
    cpiScores.push(metrics.cpi);
    spiScores.push(metrics.spi);
  });

  // Budget Health: average CPI converted to 0-100 scale
  // CPI >= 1.1 → 100, CPI = 1.0 → 70, CPI <= 0.9 → 0-40
  const budgetHealth = calculateCPIScore(cpiScores);

  // Schedule Health: average SPI converted to 0-100 scale
  // SPI >= 1.1 → 100, SPI = 1.0 → 70, SPI <= 0.9 → 0-40
  const scheduleHealth = calculateSPIScore(spiScores);

  // Risk Health: 100 - (open_risks * 5) per project
  // Cap at minimum 0
  const openRisksCount = risks.filter((r) => r.status === "open").length;
  const riskPenalty = Math.min(openRisksCount * 5, 100);
  const riskHealth = Math.max(0, 100 - riskPenalty);

  // Resource Health: based on team utilization
  // <= 80% → 100, 80-100% → 100-50, >100% → 50-0
  const resourceHealth = calculateResourceHealth(teamUtilization);

  // Overall Health: weighted average
  const overall = Math.round(
    budgetHealth * 0.3 + scheduleHealth * 0.3 + riskHealth * 0.25 + resourceHealth * 0.15
  );

  return {
    overall,
    budget: Math.round(budgetHealth),
    schedule: Math.round(scheduleHealth),
    risk: Math.round(riskHealth),
    resource: Math.round(resourceHealth),
  };
}

/**
 * Calculate EVM metrics for a single project
 */
function calculateProjectEVM(project: Project): { cpi: number; spi: number } {
  const { budget, progress, dates } = project;
  const plannedBudget = budget.planned;
  const actualCost = budget.actual;

  // Earned Value: запланированный бюджет × прогресс
  const ev = plannedBudget * (progress / 100);

  // Planned Value: запланированный бюджет × (прошедшее время / общая длительность)
  const startDate = new Date(dates.start);
  const endDate = new Date(dates.end);
  const now = new Date();

  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const scheduleProgress = Math.max(0, Math.min(1, elapsed / totalDuration));
  const pv = plannedBudget * scheduleProgress;

  // Actual Cost: фактические затраты
  const ac = actualCost;

  // CPI (Cost Performance Index): EV / AC
  const cpi = ac > 0 ? ev / ac : ev > 0 ? 1 : 0;

  // SPI (Schedule Performance Index): EV / PV
  const spi = pv > 0 ? ev / pv : ev > 0 ? 1 : 0;

  return { cpi, spi };
}

/**
 * Convert CPI values to health score (0-100)
 */
function calculateCPIScore(cpiValues: number[]): number {
  if (cpiValues.length === 0) return 0;

  const avgCPI = cpiValues.reduce((sum, cpi) => sum + cpi, 0) / cpiValues.length;

  if (avgCPI >= 1.1) return 100;
  if (avgCPI >= 1.0) return 70 + (avgCPI - 1.0) * 300; // 70-100
  if (avgCPI >= 0.9) return 40 + (avgCPI - 0.9) * 300; // 40-70
  return Math.max(0, avgCPI * 44.44); // 0-40
}

/**
 * Convert SPI values to health score (0-100)
 */
function calculateSPIScore(spiValues: number[]): number {
  if (spiValues.length === 0) return 0;

  const avgSPI = spiValues.reduce((sum, spi) => sum + spi, 0) / spiValues.length;

  if (avgSPI >= 1.1) return 100;
  if (avgSPI >= 1.0) return 70 + (avgSPI - 1.0) * 300; // 70-100
  if (avgSPI >= 0.9) return 40 + (avgSPI - 0.9) * 300; // 40-70
  return Math.max(0, avgSPI * 44.44); // 0-40
}

/**
 * Calculate resource health based on team utilization
 */
function calculateResourceHealth(utilization: number): number {
  if (utilization <= 80) return 100;
  if (utilization <= 100) return 100 - ((utilization - 80) / 20) * 50; // 100-50
  return Math.max(0, 50 - (utilization - 100) * 2.5); // 50-0 when >100%
}
