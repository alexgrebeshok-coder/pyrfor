"use client";

import { useCallback } from "react";
import useSWR from "swr";

import { api } from "@/lib/client/api-error";
import { getDemoAnalyticsRecommendations } from "@/lib/demo/workspace-data";
import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";
import type { AnalyticsRecommendationsResponse } from "@/lib/types/analytics";

const fetchRecommendations = (url: string) => api.get<AnalyticsRecommendationsResponse>(url);

export function useAnalyticsRecommendations() {
  const isDemoWorkspace = useDemoWorkspaceMode();
  const { data, error, isLoading, mutate } = useSWR<AnalyticsRecommendationsResponse>(
    isDemoWorkspace ? null : "/api/analytics/recommendations",
    fetchRecommendations,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  const demoData = getDemoAnalyticsRecommendations();
  const demoRefresh = useCallback(async () => demoData, [demoData]);

  return {
    recommendations: isDemoWorkspace ? demoData.recommendations : data?.recommendations ?? [],
    summary: isDemoWorkspace ? demoData.summary : data?.summary,
    error: isDemoWorkspace ? undefined : error,
    isLoading: isDemoWorkspace ? false : isLoading,
    refresh: isDemoWorkspace ? demoRefresh : mutate,
  };
}
