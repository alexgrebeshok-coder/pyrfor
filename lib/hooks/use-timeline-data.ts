"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { api } from "@/lib/client/api-error";
import type { ProjectTimeline } from "@/lib/types/timeline";

interface ProjectAPIResponse {
  id: string;
  name: string;
  status: string;
  start: string;
  end: string;
  progress: number;
}

interface ProjectsAPIResponse {
  projects: ProjectAPIResponse[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Map API status to timeline status
 */
function mapStatus(status: string): ProjectTimeline['status'] {
  switch (status) {
    case 'active':
      return 'active';
    case 'planning':
      return 'planning';
    case 'completed':
      return 'completed';
    case 'at_risk':
      return 'delayed';
    case 'on_hold':
      return 'planning';
    default:
      return 'planning';
  }
}

/**
 * Hook to fetch and transform project timeline data
 * Fetches from /api/projects and transforms for Gantt chart
 */
export function useTimelineData() {
  const { data, error, isLoading, mutate } = useSWR<ProjectsAPIResponse>(
    "/api/projects?limit=50",
    (url) => api.get<ProjectsAPIResponse>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const timelineData = useMemo(() => {
    if (!data?.projects) return [];

    return data.projects
      .filter((project) => project.start && project.end) // Only include projects with dates
      .map((project) => ({
        id: project.id,
        name: project.name,
        startDate: new Date(project.start),
        endDate: new Date(project.end),
        progress: project.progress || 0,
        status: mapStatus(project.status),
      } as ProjectTimeline))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime()); // Sort by start date
  }, [data]);

  return {
    data: timelineData,
    isLoading,
    error,
    refresh: mutate,
  };
}
