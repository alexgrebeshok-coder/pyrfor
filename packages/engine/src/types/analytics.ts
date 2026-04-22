/**
 * Analytics Types
 * Type definitions for budget and analytics data
 */

export interface BudgetData {
  project: string;
  planned: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

export interface BudgetChartProps {
  data: BudgetData[];
  loading?: boolean;
  className?: string;
}

export interface ProjectBudget {
  id: string;
  name: string;
  budgetPlan: number;
  budgetFact: number;
}

// Risk Analytics Types

export interface RiskData {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  probability: number; // 1-5
  impact: number; // 1-5
  severity: number; // calculated: probability * impact
  level: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'mitigating' | 'closed';
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiskMatrixCell {
  probability: number;
  impact: number;
  risks: RiskData[];
  level: 'low' | 'medium' | 'high' | 'critical';
}

export interface RiskDistributionData {
  category: string;
  count: number;
  level: 'low' | 'medium' | 'high' | 'critical';
}

export interface AnalyticsOverviewProject {
  projectId: string;
  projectName: string;
  totalTasks: number;
  statusBreakdown: {
    todo: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  priorityBreakdown: {
    high: number;
    medium: number;
    low: number;
  };
  progress: number;
  overdueTasks: number;
  healthScore: number;
  status: string;
  planFact: {
    plannedProgress: number;
    actualProgress: number;
    progressVariance: number;
    budgetVariance: number;
    budgetVarianceRatio: number;
    cpi: number | null;
    spi: number | null;
    warningCount: number;
  };
}

export interface AnalyticsOverviewSummaryPlanFact {
  portfolioCpi: number;
  portfolioSpi: number;
  projectsBehindPlan: number;
  projectsOverBudget: number;
  staleFieldReportingProjects: number;
  criticalProjects: number;
}

export interface AnalyticsOverviewSummary {
  totalProjects: number;
  totalTasks: number;
  avgProgress: number;
  totalOverdue: number;
  avgHealthScore: number;
  activeProjects: number;
  completedProjects: number;
  completedTasks: number;
  overdueTasks: number;
  teamSize: number;
  averageHealth: number;
  planFact: AnalyticsOverviewSummaryPlanFact;
}

export interface AnalyticsOverviewResponse {
  summary: AnalyticsOverviewSummary;
  projects: AnalyticsOverviewProject[];
}

export type AnalyticsRecommendationType = "budget" | "timeline" | "delivery" | "governance";
export type AnalyticsRecommendationPriority = "critical" | "high" | "medium" | "low";

export interface AnalyticsRecommendation {
  type: AnalyticsRecommendationType;
  priority: AnalyticsRecommendationPriority;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  action: string;
}

export interface AnalyticsRecommendationsSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface AnalyticsRecommendationsResponse {
  recommendations: AnalyticsRecommendation[];
  summary: AnalyticsRecommendationsSummary;
}
