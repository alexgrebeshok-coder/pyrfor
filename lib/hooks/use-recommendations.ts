"use client";

import { useMemo, useState, useCallback } from "react";
import type { Project, ProjectHealth, PortfolioHealth } from "@/lib/types";
import type { Recommendation } from "@/lib/ai/recommendations-engine";
import type { HealthScore } from "@/lib/ai/health-calculator";
import type { AIInsight } from "@/lib/ai/insights-generator";
import { generateRecommendations } from "@/lib/ai/recommendations-engine";

interface UseRecommendationsResult {
  recommendations: Recommendation[];
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
}

/**
 * Hook for generating AI-powered recommendations
 *
 * Uses rule-based logic (no external AI API) with manual refresh
 * to provide actionable insights for the portfolio.
 */
export function useRecommendations(
  projects: Project[],
  portfolioHealth: HealthScore | null,
  aiInsights: AIInsight[]
): UseRecommendationsResult {
  const [refreshKey, setRefreshKey] = useState(0);

  const recommendations = useMemo(() => {
    void refreshKey;
    try {
      // Convert HealthScore to ProjectHealth format
      const projectHealth: ProjectHealth | null = portfolioHealth ? {
        overall: portfolioHealth.overall,
        budget: portfolioHealth.budget,
        schedule: portfolioHealth.schedule,
        risks: portfolioHealth.risk,
        trend: "stable" as const,
        calculatedAt: new Date().toISOString()
      } : null;

      // Convert AIInsight[] to PortfolioHealth format (for insights parameter)
      const portfolioInsights: PortfolioHealth | null = portfolioHealth ? {
        overall: portfolioHealth.overall,
        healthy: projects.filter(p => p.status === "active" && p.health > 75).length,
        atRisk: projects.filter(p => p.status === "at-risk").length,
        critical: projects.filter(p => p.status === "at-risk" || p.health < 50).length,
        budgetVariance: 0,
        scheduleVariance: 0,
        insights: aiInsights.map(i => i.description)
      } : null;

      const result = generateRecommendations(
        projects,
        projectHealth,
        portfolioInsights
      );

      return result;
    } catch (err) {
      console.error("Error generating recommendations:", err);
      return [];
    }
  }, [projects, portfolioHealth, aiInsights, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  return {
    recommendations,
    isLoading: false,
    error: null,
    refresh,
  };
}
