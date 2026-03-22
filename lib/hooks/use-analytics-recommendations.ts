"use client";

import useSWR from "swr";

import { api } from "@/lib/client/api-error";
import type { AnalyticsRecommendationsResponse } from "@/lib/types/analytics";

const fetchRecommendations = (url: string) => api.get<AnalyticsRecommendationsResponse>(url);

export function useAnalyticsRecommendations() {
  const { data, error, isLoading, mutate } = useSWR<AnalyticsRecommendationsResponse>(
    "/api/analytics/recommendations",
    fetchRecommendations,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    recommendations: data?.recommendations ?? [],
    summary: data?.summary,
    error,
    isLoading,
    refresh: mutate,
  };
}
