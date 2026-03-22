"use client";

import { useMemo } from "react";
import useSWR, { mutate, useSWRConfig, type KeyedMutator } from "swr";

import { api, isAuthApiError } from "@/lib/client/api-error";
import {
  buildDashboardStateFromApi,
  normalizeProject,
  normalizeRisk,
  normalizeTask,
  normalizeTeamMember,
  type ApiProject,
  type ApiRisk,
  type ApiTask,
  type ApiTeamMember,
} from "@/lib/client/normalizers";

const fetcher = <T,>(url: string) => api.get<T>(url);
type MutateFn<T> = KeyedMutator<T>;

function buildQuery(filters?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();

  Object.entries(filters ?? {}).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useProjects(filters?: { status?: string; direction?: string }): {
  projects: ReturnType<typeof normalizeProject>[];
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<{ projects: ApiProject[] }>;
} {
  const key = `/api/projects${buildQuery(filters)}`;
  const { data, error, isLoading, mutate: boundMutate } = useSWR<{ projects: ApiProject[] }>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
  const projects = useMemo(() => data?.projects?.map(normalizeProject) ?? [], [data]);

  return {
    projects,
    isLoading,
    error,
    mutate: boundMutate,
  };
}

export function useTasks(filters?: {
  status?: string;
  priority?: string;
  projectId?: string;
  assigneeId?: string;
}): {
  tasks: ReturnType<typeof normalizeTask>[];
  isLoading: boolean;
  error: unknown;
  mutate: MutateFn<{ tasks: ApiTask[] }>;
} {
  const key = `/api/tasks${buildQuery(filters)}`;
  const { data, error, isLoading, mutate: boundMutate } = useSWR<{ tasks: ApiTask[] }>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
  const tasks = useMemo(() => data?.tasks?.map(normalizeTask) ?? [], [data]);

  return {
    tasks,
    isLoading,
    error,
    mutate: boundMutate,
  };
}

export function useTeam(): {
  team: ReturnType<typeof normalizeTeamMember>[];
  isLoading: boolean;
  error: unknown;
  mutate: MutateFn<{ team: ApiTeamMember[] }>;
} {
  const key = "/api/team";
  const { data, error, isLoading, mutate: boundMutate } = useSWR<{ team: ApiTeamMember[] }>(
    key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );
  const team = useMemo(() => data?.team?.map(normalizeTeamMember) ?? [], [data]);

  return {
    team,
    isLoading,
    error,
    mutate: boundMutate,
  };
}

export function useRisks(filters?: { projectId?: string; status?: string }): {
  risks: ReturnType<typeof normalizeRisk>[];
  isLoading: boolean;
  error: unknown;
  mutate: MutateFn<{ risks: ApiRisk[] }>;
} {
  const key = `/api/risks${buildQuery(filters)}`;
  const { data: response, error, isLoading, mutate: boundMutate } = useSWR<{ risks: ApiRisk[] }>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
  const risks = useMemo(() => response?.risks?.map(normalizeRisk) ?? [], [response]);

  return {
    risks,
    isLoading,
    error,
    mutate: boundMutate,
  };
}

export function useDashboardSnapshot(): {
  projects: ReturnType<typeof normalizeProject>[];
  tasks: ReturnType<typeof normalizeTask>[];
  team: ReturnType<typeof normalizeTeamMember>[];
  risks: ReturnType<typeof normalizeRisk>[];
  documents: NonNullable<ReturnType<typeof buildDashboardStateFromApi>["documents"]>;
  milestones: NonNullable<ReturnType<typeof buildDashboardStateFromApi>["milestones"]>;
  dashboard: ReturnType<typeof buildDashboardStateFromApi> | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: MutateFn<ReturnType<typeof buildDashboardStateFromApi>>;
  retry: MutateFn<ReturnType<typeof buildDashboardStateFromApi>>;
} {
  const key = "dashboard-snapshot";
  const { data, error, isLoading, mutate: boundMutate } = useSWR(
    key,
    async () => {
      try {
        const [projectsResponse, tasksResponse, teamResponse, risksResponse] = await Promise.all([
          fetcher<{ projects: ApiProject[] }>("/api/projects"),
          fetcher<{ tasks: ApiTask[] }>("/api/tasks"),
          fetcher<{ team: ApiTeamMember[] }>("/api/team"),
          fetcher<{ risks: ApiRisk[] }>("/api/risks"),
        ]);

        const projects = projectsResponse.projects ?? [];
        const tasks = tasksResponse.tasks ?? [];
        const team = teamResponse.team ?? [];
        const risks = risksResponse.risks ?? [];
        return buildDashboardStateFromApi({ projects, tasks, team, risks });
      } catch (snapshotError) {
        if (isAuthApiError(snapshotError)) {
          return buildDashboardStateFromApi({
            projects: [],
            tasks: [],
            team: [],
            risks: [],
          });
        }

        throw snapshotError;
      }
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    projects: data?.projects ?? [],
    tasks: data?.tasks ?? [],
    team: data?.team ?? [],
    risks: data?.risks ?? [],
    documents: data?.documents ?? [],
    milestones: data?.milestones ?? [],
    dashboard: data,
    isLoading,
    error,
    mutate: boundMutate,
    retry: boundMutate,
  };
}

export function useMutation<T, P = void>(
  key: string,
  mutationFn: (params: P) => Promise<T>
): (params: P) => Promise<T> {
  const { mutate: globalMutate } = useSWRConfig();

  return async (params: P) => {
    const result = await mutationFn(params);
    await globalMutate((candidateKey) => candidateKey === key || candidateKey === "dashboard-snapshot");
    return result;
  };
}

export function useProjectMutations(): {
  createProject: (data: Record<string, unknown>) => Promise<unknown>;
  updateProject: (data: { id: string; payload: Record<string, unknown> }) => Promise<unknown>;
  deleteProject: (id: string) => Promise<unknown>;
} {
  const createProject = useMutation("/api/projects", (data: Record<string, unknown>) =>
    api.post("/api/projects", data)
  );

  const updateProject = useMutation(
    "/api/projects",
    (data: { id: string; payload: Record<string, unknown> }) =>
      api.put(`/api/projects/${data.id}`, data.payload)
  );

  const deleteProject = useMutation("/api/projects", (id: string) =>
    api.delete(`/api/projects/${id}`)
  );

  return { createProject, updateProject, deleteProject };
}

export function revalidateAll(): void {
  void mutate((key) => typeof key === "string" && key.startsWith("/api/"));
  void mutate("dashboard-snapshot");
}
