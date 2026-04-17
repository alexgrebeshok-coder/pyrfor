"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { useLocale } from "@/contexts/locale-context";
import { api } from "@/lib/client/api-error";
import {
  buildDashboardStateFromApi,
  type ApiProject,
  type ApiRisk,
  type ApiTask,
  type ApiTeamMember,
} from "@/lib/client/normalizers";
import { demoDashboardState } from "@/lib/demo/workspace-data";
import { isDemoWorkspacePath } from "@/lib/demo/workspace-paths";
import { isPublicAppPath } from "@/lib/public-paths";
import type { DashboardState } from "@/lib/types";
import { createDashboardActions } from "@/components/dashboard-provider-actions";
import {
  buildNotifications,
  emptyDashboardState,
  isExpectedDashboardLoadError,
  readCachedState,
  writeCachedState,
  writeCachedStateDebounced,
} from "@/components/dashboard-provider-helpers";
import type { DashboardContextValue } from "@/components/dashboard-provider.types";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const DashboardContext = createContext<DashboardContextValue | null>(null);
export { DashboardContext };

export function DashboardProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isPublicPage = isPublicAppPath(pathname);
  const isDemoWorkspace = isDemoWorkspacePath(pathname);
  const { enumLabel, t } = useLocale();
  const [state, setState] = useState<DashboardState>(
    isDemoWorkspace ? demoDashboardState : emptyDashboardState
  );
  const [isLoading, setIsLoading] = useState(!isPublicPage && !isDemoWorkspace);
  const [error, setError] = useState<string | null>(null);
  // P3-2: Track degraded mode (using cached/mock data)
  const [isDegradedMode, setIsDegradedMode] = useState(false);

  const loadDashboardData = useCallback(async (options?: { silent?: boolean }) => {
    if (isDemoWorkspace) {
      setState(demoDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return demoDashboardState;
    }

    try {
      if (!options?.silent) {
        setIsLoading(true);
      }
      setError(null);

      const [projectsRes, tasksRes, teamRes, risksRes] = await Promise.all([
        api.get<{ projects: ApiProject[] }>(
          "/api/projects?includeTeam=true&includeRisks=true&includeMilestones=true&includeDocuments=true"
        ),
        api.get<{ tasks: ApiTask[] }>("/api/tasks"),
        api.get<{ team: ApiTeamMember[] }>("/api/team"),
        api.get<{ risks: ApiRisk[] }>("/api/risks"),
      ]);

      const nextState = buildDashboardStateFromApi({
        projects: projectsRes.projects ?? [],
        tasks: tasksRes.tasks ?? [],
        team: teamRes.team ?? [],
        risks: risksRes.risks ?? [],
      });

      setState(nextState);
      writeCachedState(nextState);
      return nextState;
    } catch (loadError) {
      if (!isExpectedDashboardLoadError(loadError)) {
        console.error("Failed to load dashboard data", loadError);
      }
      setError(loadError instanceof Error ? loadError.message : t("error.loadDescription"));

      setIsDegradedMode(true);

      if (!IS_PRODUCTION) {
        const cachedState = readCachedState();
        if (cachedState && cachedState.projects.length > 0) {
          setState(cachedState);
          return cachedState;
        }
      }

      setState(emptyDashboardState);
      return emptyDashboardState;
    } finally {
      setIsLoading(false);
    }
  }, [isDemoWorkspace, t]);

  useEffect(() => {
    if (isDemoWorkspace) {
      setState(demoDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return;
    }

    if (isPublicPage) {
      setState(emptyDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return;
    }

    void loadDashboardData();
  }, [isDemoWorkspace, isPublicPage, loadDashboardData]);

  useEffect(() => {
    if (isPublicPage || isDemoWorkspace || isLoading) return;
    // P3-2: Use debounced write to avoid excessive localStorage writes
    writeCachedStateDebounced(state);
  }, [isDemoWorkspace, isPublicPage, isLoading, state]);

  const notifications = useMemo(() => buildNotifications(state, t), [state, t]);

  const retry = useCallback(() => {
    if (isDemoWorkspace) {
      setState(demoDashboardState);
      setError(null);
      setIsDegradedMode(false);
      setIsLoading(false);
      return;
    }

    setIsDegradedMode(false);
    void loadDashboardData();
  }, [isDemoWorkspace, loadDashboardData]);

  const notifyDemoReadonly = useCallback(() => {
    toast.info("Публичное demo работает в режиме read-only", {
      description: "Сначала смотрим сценарии и метрики, а боевые изменения остаются за логином.",
    });
  }, []);

  const actions = useMemo(
    () =>
      createDashboardActions({
        enumLabel,
        isDemoWorkspace,
        loadDashboardData,
        notifyDemoReadonly,
        setState,
        state,
        t,
      }),
    [enumLabel, isDemoWorkspace, loadDashboardData, notifyDemoReadonly, state, t]
  );

  const value = useMemo<DashboardContextValue>(
    () => ({
      ...state,
      isHydrating: isLoading,
      isLoading,
      error,
      isDegradedMode,
      notifications,
      retry,
      ...actions,
    }),
    [actions, error, isDegradedMode, isLoading, notifications, retry, state]
  );

  return (
    <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }

  return context;
}
