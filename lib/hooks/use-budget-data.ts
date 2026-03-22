"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/client/api-error";
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
  const { data, error, isLoading, mutate } = useSWR<ProjectsAPIResponse>(
    "/api/projects?limit=50",
    (url) => api.get<ProjectsAPIResponse>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const budgetData = useMemo(() => {
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
  }, [data]);

  return {
    data: budgetData,
    isLoading,
    error,
    refresh: mutate,
  };
}
