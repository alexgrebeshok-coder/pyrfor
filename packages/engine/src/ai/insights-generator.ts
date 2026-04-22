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
export function generateInsights(
  projects: Project[],
  evmMetricsMap: Map<string, EVMMetrics>,
  risksMap: Map<string, AutoRisk[]>
): AIInsight[] {
  const insights: AIInsight[] = [];
  const now = new Date().toISOString();

  // 1. TREND: Analyze CPI trends across projects
  const cpiValues = Array.from(evmMetricsMap.values()).map((m) => m.cpi);
  if (cpiValues.length > 0) {
    const avgCpi = cpiValues.reduce((sum, cpi) => sum + cpi, 0) / cpiValues.length;
    const recentCpiTrend = analyzeCPITrend(projects, evmMetricsMap);

    if (recentCpiTrend < -0.05) {
      insights.push({
        id: `trend-cpi-${Date.now()}`,
        type: "trend",
        severity: "warning",
        title: "CPI falling across portfolio",
        description: `Average CPI dropped by ${(recentCpiTrend * 100).toFixed(1)}% over the last 2 weeks. Projects are burning budget faster than planned.`,
        detectedAt: now,
      });
    } else if (avgCpi > 1.1) {
      insights.push({
        id: `trend-cpi-good-${Date.now()}`,
        type: "trend",
        severity: "info",
        title: "Portfolio performing under budget",
        description: `Average CPI is ${avgCpi.toFixed(2)}. The portfolio is spending efficiently with ${(avgCpi - 1) * 100}% cost savings overall.`,
        detectedAt: now,
      });
    }
  }

  // 2. ANOMALY: Detect unusual SPI deviations
  for (const [projectId, metrics] of evmMetricsMap.entries()) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || !metrics) continue;

    const allSpiValues = Array.from(evmMetricsMap.values()).map((m) => m.spi);
    const avgSpi =
      allSpiValues.reduce((sum, spi) => sum + spi, 0) / allSpiValues.length;

    if (Math.abs(metrics.spi - avgSpi) > 0.3 && metrics.spi < avgSpi) {
      insights.push({
        id: `anomaly-spi-${projectId}`,
        type: "anomaly",
        severity: metrics.spi < 0.7 ? "critical" : "warning",
        title: `Unusual SPI deviation in "${project.name}"`,
        description: `SPI = ${metrics.spi.toFixed(2)} vs portfolio average ${avgSpi.toFixed(2)}. This project is significantly behind schedule.`,
        projectId,
        detectedAt: now,
      });
    }

    // Detect unusual cost variance
    const budgetVariance = (metrics.ac - metrics.pv) / metrics.pv;
    if (Math.abs(budgetVariance) > 0.3) {
      insights.push({
        id: `anomaly-budget-${projectId}`,
        type: "anomaly",
        severity: budgetVariance > 0.3 ? "critical" : "warning",
        title: `Unusual cost variance in "${project.name}"`,
        description: `Cost deviation of ${(budgetVariance * 100).toFixed(1)}% detected. Actual spending is ${(metrics.ac / 1000).toFixed(0)}k vs planned ${(metrics.pv / 1000).toFixed(0)}k.`,
        projectId,
        detectedAt: now,
      });
    }
  }

  // 3. PATTERN: Detect common delay patterns
  const delayedProjects = projects.filter((p) => {
    const metrics = evmMetricsMap.get(p.id);
    return metrics && metrics.spi < 0.9;
  });

  if (delayedProjects.length >= 3 && delayedProjects.length <= projects.length * 0.7) {
    const commonDirections = getCommonDirections(delayedProjects);
    if (commonDirections.length > 0) {
      insights.push({
        id: `pattern-delay-${Date.now()}`,
        type: "pattern",
        severity: "warning",
        title: `Similar delay pattern across ${delayedProjects.length} projects`,
        description: `Projects in ${commonDirections.join(", ")} directions show schedule delays. Consider reviewing resource allocation or planning methodology.`,
        detectedAt: now,
      });
    } else {
      insights.push({
        id: `pattern-delay-${Date.now()}`,
        type: "pattern",
        severity: "warning",
        title: `${delayedProjects.length} projects falling behind schedule`,
        description: `SPI < 0.9 detected across multiple projects. Review critical paths and resource availability.`,
        detectedAt: now,
      });
    }
  }

  // 4. PATTERN: Detect budget overrun patterns
  const overBudgetProjects = projects.filter((p) => {
    const metrics = evmMetricsMap.get(p.id);
    return metrics && metrics.cpi < 0.9;
  });

  if (overBudgetProjects.length >= 2) {
    insights.push({
      id: `pattern-budget-${Date.now()}`,
      type: "pattern",
      severity: overBudgetProjects.length > projects.length * 0.5 ? "critical" : "warning",
      title: `Budget trend: ${overBudgetProjects.length} projects over budget`,
      description: `CPI < 0.9 indicates cost overruns. Total projected variance: ${overBudgetProjects.reduce((sum, p) => {
        const metrics = evmMetricsMap.get(p.id);
        return sum + (metrics ? metrics.vac : 0);
      }, 0) / 1000}k`,
      detectedAt: now,
    });
  }

  // 5. WARNING: Budget overrun prediction
  for (const [projectId, metrics] of evmMetricsMap.entries()) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || !metrics) continue;

    const progressRemaining = 100 - metrics.percentComplete;
    const projectedOverrun = metrics.eac - project.budget.planned;
    const overrunPercent = (projectedOverrun / project.budget.planned) * 100;

    if (metrics.cpi < 0.85 && progressRemaining > 30 && overrunPercent > 10) {
      insights.push({
        id: `warning-budget-${projectId}`,
        type: "warning",
        severity: "critical",
        title: `Budget overrun predicted for "${project.name}"`,
        description: `At current CPI of ${metrics.cpi.toFixed(2)}, project is forecasted to exceed budget by ${overrunPercent.toFixed(1)}% (${(projectedOverrun / 1000).toFixed(0)}k).`,
        projectId,
        detectedAt: now,
      });
    }
  }

  // 6. WARNING: Risk concentration
  for (const [projectId, projectRisks] of risksMap.entries()) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) continue;

    const criticalRisks = projectRisks.filter((r) => r.severity === "critical");
    if (criticalRisks.length >= 3) {
      insights.push({
        id: `warning-risks-${projectId}`,
        type: "warning",
        severity: "critical",
        title: `Critical risk concentration in "${project.name}"`,
        description: `${criticalRisks.length} critical risks detected. Risk mitigation capacity may be exceeded. Prioritize high-impact risks immediately.`,
        projectId,
        detectedAt: now,
      });
    }
  }

  // 7. INFO: Portfolio health summary
  if (projects.length > 0) {
    const avgHealth = projects.reduce((sum, p) => sum + p.health, 0) / projects.length;
    const healthyProjects = projects.filter((p) => p.health >= 70).length;

    if (avgHealth >= 80) {
      insights.push({
        id: `info-health-${Date.now()}`,
        type: "trend",
        severity: "info",
        title: "Portfolio health trending positive",
        description: `${healthyProjects} of ${projects.length} projects are healthy (${Math.round(avgHealth)}% average). Good execution across the board.`,
        detectedAt: now,
      });
    } else if (avgHealth < 60) {
      insights.push({
        id: `info-health-${Date.now()}`,
        type: "warning",
        severity: "warning",
        title: "Portfolio health requires attention",
        description: `Average health score is ${Math.round(avgHealth)}%. Review underperforming projects and allocate recovery resources.`,
        detectedAt: now,
      });
    }
  }

  // Sort insights by severity and limit to top 5-7
  return insights
    .sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })
    .slice(0, 7);
}

/**
 * Analyze CPI trend from project history
 */
function analyzeCPITrend(
  projects: Project[],
  _evmMetricsMap: Map<string, EVMMetrics>
): number {
  let totalChange = 0;
  let count = 0;

  for (const project of projects) {
    if (project.history.length < 2) continue;

    // Compare last two history points for each project
    const last = project.history[project.history.length - 1];
    const prev = project.history[project.history.length - 2];

    if (last && prev && prev.budgetPlanned > 0) {
      const lastCpi = last.budgetPlanned > 0 ? last.budgetActual / last.budgetPlanned : 1;
      const prevCpi = prev.budgetPlanned > 0 ? prev.budgetActual / prev.budgetPlanned : 1;
      const change = lastCpi - prevCpi;

      totalChange += change;
      count++;
    }
  }

  return count > 0 ? totalChange / count : 0;
}

/**
 * Get common project directions from a list of projects
 */
function getCommonDirections(projects: Project[]): string[] {
  const directionCounts = new Map<string, number>();

  for (const project of projects) {
    const count = directionCounts.get(project.direction) || 0;
    directionCounts.set(project.direction, count + 1);
  }

  // Return directions with 2 or more projects
  return Array.from(directionCounts.entries())
    .filter(([_, count]) => count >= 2)
    .map(([direction]) => direction);
}
