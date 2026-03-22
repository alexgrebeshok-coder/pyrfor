"use client";

import useSWR from "swr";

import { api } from "@/lib/client/api-error";
import type { TeamPerformanceResponse } from "@/lib/types/team-performance";

const fetchTeamPerformance = (url: string) => api.get<TeamPerformanceResponse>(url);

export function useAnalyticsTeamPerformance(projectId?: string) {
  const key = projectId ? `/api/analytics/team-performance?projectId=${projectId}` : "/api/analytics/team-performance";
  const { data, error, isLoading, mutate } = useSWR<TeamPerformanceResponse>(key, fetchTeamPerformance, {
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
