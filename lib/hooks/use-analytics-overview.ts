"use client";

import useSWR from "swr";

import { api, isAuthApiError } from "@/lib/client/api-error";
import type { AnalyticsOverviewResponse } from "@/lib/types/analytics";

const emptyOverview: AnalyticsOverviewResponse = {
  summary: {
    totalProjects: 0,
    totalTasks: 0,
    avgProgress: 0,
    totalOverdue: 0,
    avgHealthScore: 0,
    activeProjects: 0,
    completedProjects: 0,
    completedTasks: 0,
    overdueTasks: 0,
    teamSize: 0,
    averageHealth: 0,
    planFact: {
      portfolioCpi: 0,
      portfolioSpi: 0,
      projectsBehindPlan: 0,
      projectsOverBudget: 0,
      staleFieldReportingProjects: 0,
      criticalProjects: 0,
    },
  },
  projects: [],
};

const fetchOverview = async (url: string) => {
  try {
    return await api.get<AnalyticsOverviewResponse>(url);
  } catch (error) {
    if (isAuthApiError(error)) {
      return emptyOverview;
    }

    throw error;
  }
};

export function useAnalyticsOverview(projectId?: string) {
  const key = projectId ? `/api/analytics/overview?projectId=${projectId}` : "/api/analytics/overview";
  const { data, error, isLoading, mutate } = useSWR<AnalyticsOverviewResponse>(key, fetchOverview, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  return {
    data,
    error,
    isLoading,
    refresh: mutate,
  };
}
