"use client";

import { useCallback } from "react";
import useSWR from "swr";

import { api, isAuthApiError } from "@/lib/client/api-error";
import { getDemoAnalyticsOverview } from "@/lib/demo/workspace-data";
import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";
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
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = projectId ? `/api/analytics/overview?projectId=${projectId}` : "/api/analytics/overview";
  const { data, error, isLoading, mutate } = useSWR<AnalyticsOverviewResponse>(
    isDemoWorkspace ? null : key,
    fetchOverview,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  const demoData = getDemoAnalyticsOverview();
  const demoRefresh = useCallback(async () => demoData, [demoData]);

  return {
    data: isDemoWorkspace ? demoData : data,
    error: isDemoWorkspace ? undefined : error,
    isLoading: isDemoWorkspace ? false : isLoading,
    refresh: isDemoWorkspace ? demoRefresh : mutate,
  };
}
