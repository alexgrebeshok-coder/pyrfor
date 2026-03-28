"use client";

import { useCallback, useMemo } from "react";
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
import {
  demoDashboardState,
  getDemoApiProjects,
  getDemoApiRisks,
  getDemoApiTasks,
  getDemoApiTeam,
} from "@/lib/demo/workspace-data";
import { useDemoWorkspaceMode } from "@/lib/demo/use-demo-workspace";

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
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = `/api/projects${buildQuery(filters)}`;
  const { data, error, isLoading, mutate: boundMutate } = useSWR<{ projects: ApiProject[] }>(
    isDemoWorkspace ? null : key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  const demoProjects = useMemo(() => {
    const projects = getDemoApiProjects();
    return projects.filter((project) => {
      const statusMatch = filters?.status ? project.status === filters.status : true;
      const directionMatch = filters?.direction ? project.direction === filters.direction : true;
      return statusMatch && directionMatch;
    });
  }, [filters?.direction, filters?.status]);
  const projects = useMemo(
    () => (isDemoWorkspace ? demoProjects.map(normalizeProject) : data?.projects?.map(normalizeProject) ?? []),
    [data, demoProjects, isDemoWorkspace]
  );
  const demoMutate = useCallback(async () => ({ projects: demoProjects }), [demoProjects]);

  return {
    projects,
    isLoading: isDemoWorkspace ? false : isLoading,
    error: isDemoWorkspace ? undefined : error,
    mutate: isDemoWorkspace ? (demoMutate as KeyedMutator<{ projects: ApiProject[] }>) : boundMutate,
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
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = `/api/tasks${buildQuery(filters)}`;
  const { data, error, isLoading, mutate: boundMutate } = useSWR<{ tasks: ApiTask[] }>(
    isDemoWorkspace ? null : key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  const demoTasks = useMemo(() => {
    return getDemoApiTasks().filter((task) => {
      const statusMatch = filters?.status ? task.status === filters.status : true;
      const priorityMatch = filters?.priority ? task.priority === filters.priority : true;
      const projectMatch = filters?.projectId ? task.projectId === filters.projectId : true;
      const assigneeMatch = filters?.assigneeId ? task.assigneeId === filters.assigneeId : true;
      return statusMatch && priorityMatch && projectMatch && assigneeMatch;
    });
  }, [filters?.assigneeId, filters?.priority, filters?.projectId, filters?.status]);
  const tasks = useMemo(
    () => (isDemoWorkspace ? demoTasks.map(normalizeTask) : data?.tasks?.map(normalizeTask) ?? []),
    [data, demoTasks, isDemoWorkspace]
  );
  const demoMutate = useCallback(async () => ({ tasks: demoTasks }), [demoTasks]);

  return {
    tasks,
    isLoading: isDemoWorkspace ? false : isLoading,
    error: isDemoWorkspace ? undefined : error,
    mutate: isDemoWorkspace ? (demoMutate as MutateFn<{ tasks: ApiTask[] }>) : boundMutate,
  };
}

export function useTeam(): {
  team: ReturnType<typeof normalizeTeamMember>[];
  isLoading: boolean;
  error: unknown;
  mutate: MutateFn<{ team: ApiTeamMember[] }>;
} {
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = "/api/team";
  const { data, error, isLoading, mutate: boundMutate } = useSWR<{ team: ApiTeamMember[] }>(
    isDemoWorkspace ? null : key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );
  const demoTeam = useMemo(() => getDemoApiTeam(), []);
  const team = useMemo(
    () => (isDemoWorkspace ? demoTeam.map(normalizeTeamMember) : data?.team?.map(normalizeTeamMember) ?? []),
    [data, demoTeam, isDemoWorkspace]
  );
  const demoMutate = useCallback(async () => ({ team: demoTeam }), [demoTeam]);

  return {
    team,
    isLoading: isDemoWorkspace ? false : isLoading,
    error: isDemoWorkspace ? undefined : error,
    mutate: isDemoWorkspace ? (demoMutate as MutateFn<{ team: ApiTeamMember[] }>) : boundMutate,
  };
}

export function useRisks(filters?: { projectId?: string; status?: string }): {
  risks: ReturnType<typeof normalizeRisk>[];
  isLoading: boolean;
  error: unknown;
  mutate: MutateFn<{ risks: ApiRisk[] }>;
} {
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = `/api/risks${buildQuery(filters)}`;
  const { data: response, error, isLoading, mutate: boundMutate } = useSWR<{ risks: ApiRisk[] }>(
    isDemoWorkspace ? null : key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );
  const demoRisks = useMemo(() => {
    return getDemoApiRisks().filter((risk) => {
      const projectMatch = filters?.projectId ? risk.projectId === filters.projectId : true;
      const statusMatch = filters?.status ? risk.status === filters.status : true;
      return projectMatch && statusMatch;
    });
  }, [filters?.projectId, filters?.status]);
  const risks = useMemo(
    () => (isDemoWorkspace ? demoRisks.map(normalizeRisk) : response?.risks?.map(normalizeRisk) ?? []),
    [demoRisks, isDemoWorkspace, response]
  );
  const demoMutate = useCallback(async () => ({ risks: demoRisks }), [demoRisks]);

  return {
    risks,
    isLoading: isDemoWorkspace ? false : isLoading,
    error: isDemoWorkspace ? undefined : error,
    mutate: isDemoWorkspace ? (demoMutate as MutateFn<{ risks: ApiRisk[] }>) : boundMutate,
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
  const isDemoWorkspace = useDemoWorkspaceMode();
  const key = "dashboard-snapshot";
  const { data, error, isLoading, mutate: boundMutate } = useSWR(
    isDemoWorkspace ? null : key,
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
  const demoMutate = useCallback(async () => demoDashboardState, []);

  return {
    projects: isDemoWorkspace ? demoDashboardState.projects : data?.projects ?? [],
    tasks: isDemoWorkspace ? demoDashboardState.tasks : data?.tasks ?? [],
    team: isDemoWorkspace ? demoDashboardState.team : data?.team ?? [],
    risks: isDemoWorkspace ? demoDashboardState.risks : data?.risks ?? [],
    documents: isDemoWorkspace ? demoDashboardState.documents : data?.documents ?? [],
    milestones: isDemoWorkspace ? demoDashboardState.milestones : data?.milestones ?? [],
    dashboard: isDemoWorkspace ? demoDashboardState : data,
    isLoading: isDemoWorkspace ? false : isLoading,
    error: isDemoWorkspace ? undefined : error,
    mutate: isDemoWorkspace ? (demoMutate as MutateFn<ReturnType<typeof buildDashboardStateFromApi>>) : boundMutate,
    retry: isDemoWorkspace ? (demoMutate as MutateFn<ReturnType<typeof buildDashboardStateFromApi>>) : boundMutate,
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
