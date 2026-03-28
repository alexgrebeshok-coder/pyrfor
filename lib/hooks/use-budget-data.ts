"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/client/api-error";
import { getDemoBudgetData, getDemoProjectsFinanceResponse } from "@/lib/demo/workspace-data";
import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";
import type { BudgetData, ProjectBudget } from "@/lib/types/analytics";

interface ProjectsAPIResponse {
  projects: ProjectBudget[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Hook to fetch and transform project budget data for analytics
 * Fetches from /api/projects and calculates variance metrics
 */
export function useBudgetData() {
  const isDemoWorkspace = useDemoWorkspaceMode();
  const { data, error, isLoading, mutate } = useSWR<ProjectsAPIResponse>(
    isDemoWorkspace ? null : "/api/projects?limit=50",
    (url) => api.get<ProjectsAPIResponse>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const demoBudgetData = useMemo(() => getDemoBudgetData(), []);
  const budgetData = useMemo(() => {
    if (isDemoWorkspace) {
      return demoBudgetData;
    }

    if (!data?.projects) return [];

    return data.projects
      .filter((project) => project.budgetPlan > 0) // Only include projects with budget
      .map((project) => {
        const planned = project.budgetPlan;
        const actual = project.budgetFact;
        const variance = planned - actual;
        const variancePercent = planned > 0 ? (variance / planned) * 100 : 0;

        return {
          project: project.name,
          planned,
          actual,
          variance,
          variancePercent: Math.round(variancePercent * 10) / 10, // Round to 1 decimal
        } as BudgetData;
      })
      .sort((a, b) => b.planned - a.planned); // Sort by budget size descending
  }, [data, demoBudgetData, isDemoWorkspace]);
  const demoRefresh = useCallback(async () => getDemoProjectsFinanceResponse(), []);

  return {
    data: budgetData,
    isLoading: isDemoWorkspace ? false : isLoading,
    error: isDemoWorkspace ? undefined : error,
    refresh: isDemoWorkspace ? demoRefresh : mutate,
  };
}
