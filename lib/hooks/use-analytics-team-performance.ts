"use client";

import { useCallback } from "react";
import useSWR from "swr";

import { api } from "@/lib/client/api-error";
import { getDemoTeamPerformance } from "@/lib/demo/workspace-data";
import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";
import type { TeamPerformanceResponse } from "@/lib/types/team-performance";

const fetchTeamPerformance = (url: string) => api.get<TeamPerformanceResponse>(url);

export function useAnalyticsTeamPerformance(projectId?: string) {
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = projectId ? `/api/analytics/team-performance?projectId=${projectId}` : "/api/analytics/team-performance";
  const { data, error, isLoading, mutate } = useSWR<TeamPerformanceResponse>(
    isDemoWorkspace ? null : key,
    fetchTeamPerformance,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  const demoData = getDemoTeamPerformance();
  const demoRefresh = useCallback(async () => demoData, [demoData]);

  return {
    data: isDemoWorkspace ? demoData : data,
    error: isDemoWorkspace ? undefined : error,
    isLoading: isDemoWorkspace ? false : isLoading,
    refresh: isDemoWorkspace ? demoRefresh : mutate,
  };
}
