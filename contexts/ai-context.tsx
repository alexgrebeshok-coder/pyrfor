"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { useDashboard } from "@/components/dashboard-provider";
import { useLocale } from "@/contexts/locale-context";
import { usePreferences } from "@/contexts/preferences-context";
import { createAIAdapter } from "@/lib/ai/adapter";
import { createDesktopLocalGatewayAdapter } from "@/lib/ai/desktop-local-gateway-adapter";
import { getDesktopLocalGatewayStatus } from "@/lib/desktop/local-gateway";
import { AUTO_AGENT_ID, aiAgents, getAgentById } from "@/lib/ai/agents";
import { resolveAgentId } from "@/lib/ai/auto-routing";
import { getQuickActionsForContext } from "@/lib/ai/quick-actions";
import type {
  AIAdapterMode,
  AIContextRef,
  AIQuickActionDefinition,
  AIRunRecord,
  AIWorkspaceMode,
} from "@/lib/ai/types";
import {
  buildChatSessionTitle,
  createChatSession,
  loadPersistedChatState,
  savePersistedChatState,
} from "@/lib/chat/storage";
import type { ChatSession } from "@/lib/chat/types";
import { isTauriDesktop } from "@/lib/utils";

interface AIWorkspaceContextValue {
  adapterMode: AIAdapterMode;
  preferredMode: AIWorkspaceMode;
  isChatStateReady: boolean;
  activeContext: AIContextRef;
  agents: typeof aiAgents;
  quickActions: AIQuickActionDefinition[];
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  currentSessionId: string | null;
  runs: AIRunRecord[];
  selectedRun: AIRunRecord | null;
  selectedRunId: string | null;
  selectedAgentId: string;
  isDrawerOpen: boolean;
  isSubmitting: boolean;
  applyingProposalIds: string[];
  openDrawer: () => void;
  closeDrawer: () => void;
  createSession: () => void;
  selectSession: (sessionId: string) => void;
  selectRun: (runId: string) => void;
  setPreferredMode: (mode: AIWorkspaceMode) => void;
  setSelectedAgentId: (agentId: string) => void;
  submitPrompt: (prompt: string) => Promise<void>;
  runQuickAction: (actionId: string) => Promise<void>;
  applyProposal: (runId: string, proposalId: string) => Promise<void>;
  dismissProposal: (runId: string, proposalId: string) => void;
  stopGeneration: () => void;
  regenerateRun: (runId: string) => Promise<void>;
}

const AIWorkspaceContext = createContext<AIWorkspaceContextValue | null>(null);
const terminalStatuses = new Set(["done", "failed", "needs_approval"]);
const MIN_TIME_BETWEEN_RUNS = 3000;
const MODE_STORAGE_KEY = "ceoclaw-ai-mode";
const AGENT_STORAGE_KEY = "ceoclaw-ai-agent";

function isLocalGatewayUrl(url?: string | null) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return /localhost|127\.0\.0\.1|::1/i.test(url);
  }
}

const portfolioContextByPath = {
  "/": {
    titleKey: "page.dashboard.title",
    subtitleKey: "page.dashboard.eyebrow",
  },
  "/projects": {
    titleKey: "page.projects.title",
    subtitleKey: "page.projects.eyebrow",
  },
  "/kanban": {
    titleKey: "page.kanban.title",
    subtitleKey: "page.kanban.eyebrow",
  },
  "/calendar": {
    titleKey: "page.calendar.title",
    subtitleKey: "page.calendar.eyebrow",
  },
  "/gantt": {
    titleKey: "page.gantt.title",
    subtitleKey: "page.gantt.eyebrow",
  },
  "/analytics": {
    titleKey: "page.analytics.title",
    subtitleKey: "page.analytics.eyebrow",
  },
  "/team": {
    titleKey: "page.team.title",
    subtitleKey: "page.team.eyebrow",
  },
} as const;

function resolveActiveContext(
  pathname: string,
  projectContext: AIContextRef | null,
  t: ReturnType<typeof useLocale>["t"]
): AIContextRef {
  if (projectContext) {
    return projectContext;
  }

  if (pathname.startsWith("/tasks")) {
    return {
      type: "tasks",
      pathname,
      title: t("page.tasks.title"),
      subtitle: t("page.tasks.eyebrow"),
    };
  }

  const portfolioContext =
    portfolioContextByPath[pathname as keyof typeof portfolioContextByPath] ??
    portfolioContextByPath["/"];

  return {
    type: "portfolio",
    pathname,
    title: t(portfolioContext.titleKey),
    subtitle: t(portfolioContext.subtitleKey),
  };
}

function sortSessionsByUpdatedDesc(sessions: ChatSession[]) {
  return [...sessions].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function sortRunsByCreatedDesc(runs: AIRunRecord[]) {
  return [...runs].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

export function AIProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { locale, t } = useLocale();
  const {
    preferences: { aiResponseLocale },
  } = usePreferences();
  const { addTasksBatch, notifications, projects, risks, tasks, team } = useDashboard();
  const [allRuns, setAllRuns] = useState<AIRunRecord[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentIdState] = useState(AUTO_AGENT_ID);
  const [preferredMode, setPreferredModeState] = useState<AIWorkspaceMode>("auto");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applyingProposalIds, setApplyingProposalIds] = useState<string[]>([]);
  const [isChatStateReady, setIsChatStateReady] = useState(false);
  const pollTimeoutsRef = useRef<Map<string, number>>(new Map());
  const lastRunStartedAtRef = useRef(0);
  const submissionInFlightRef = useRef(false);
  const lastWorkbenchPathRef = useRef("/");
  const abortControllerRef = useRef<AbortController | null>(null);
  const warmupLocalGatewayRef = useRef(false);

  const isDesktop = isTauriDesktop();
  const isChatPage = pathname === "/chat";
  const adapterMode: AIAdapterMode = preferredMode === "mock" ? "mock" : "gateway";
  const adapter = useMemo(() => {
    if (preferredMode === "local" && isDesktop) {
      return createDesktopLocalGatewayAdapter();
    }

    return createAIAdapter(adapterMode);
  }, [adapterMode, isDesktop, preferredMode]);
  const contextPathname = pathname === "/chat" ? lastWorkbenchPathRef.current : pathname;

  useEffect(() => {
    if (pathname !== "/chat") {
      lastWorkbenchPathRef.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    if (!isDesktop || preferredMode !== "local" || warmupLocalGatewayRef.current) {
      return;
    }

    warmupLocalGatewayRef.current = true;
    void getDesktopLocalGatewayStatus();
  }, [isDesktop, preferredMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedAgentId = window.localStorage.getItem(AGENT_STORAGE_KEY);
    if (savedAgentId && getAgentById(savedAgentId)) {
      setSelectedAgentIdState(savedAgentId);
    }

    const savedMode = window.localStorage.getItem(MODE_STORAGE_KEY) as AIWorkspaceMode | null;
    if (savedMode === "mock" || savedMode === "gateway" || savedMode === "local" || savedMode === "provider") {
      setPreferredModeState(savedMode);
    } else {
      if (isTauriDesktop()) {
        setPreferredModeState("local");
        window.localStorage.setItem(MODE_STORAGE_KEY, "local");
      } else {
        const envMode = process.env.NEXT_PUBLIC_SEOCLAW_AI_MODE;
        const gatewayUrl = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL;

        if (envMode === "mock") {
          setPreferredModeState("mock");
        } else if (isLocalGatewayUrl(gatewayUrl)) {
          setPreferredModeState("local");
        } else if (envMode === "gateway") {
          setPreferredModeState("gateway");
        } else {
          setPreferredModeState("auto");
        }
      }
    }

    const persistedChatState = loadPersistedChatState();
    if (persistedChatState) {
      setAllRuns(persistedChatState.runs);
      setSessions(persistedChatState.sessions);
      setCurrentSessionId(persistedChatState.currentSessionId);
      setSelectedRunId(persistedChatState.selectedRunId);
    } else {
      const initialSession = createChatSession();
      setSessions([initialSession]);
      setCurrentSessionId(initialSession.id);
      setSelectedRunId(null);
    }

    setIsChatStateReady(true);
  }, []);

  useEffect(() => {
    if (!isChatStateReady || typeof window === "undefined") return;

    savePersistedChatState({
      sessions,
      runs: allRuns,
      currentSessionId,
      selectedRunId,
    });
  }, [allRuns, currentSessionId, isChatStateReady, selectedRunId, sessions]);

  const setSelectedAgentId = (agentId: string) => {
    setSelectedAgentIdState(agentId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AGENT_STORAGE_KEY, agentId);
    }
  };

  const setPreferredMode = (mode: AIWorkspaceMode) => {
    setPreferredModeState(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  };

  const projectContext = useMemo(() => {
    if (!contextPathname.startsWith("/projects/")) {
      return null;
    }

    const projectId = contextPathname.split("/")[2];
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return null;
    }

    return {
      type: "project" as const,
      pathname: contextPathname,
      projectId,
      title: project.name,
      subtitle: t("page.project.eyebrow"),
    };
  }, [contextPathname, projects, t]);

  const activeContext = useMemo(
    () => resolveActiveContext(contextPathname, projectContext, t),
    [contextPathname, projectContext, t]
  );
  const quickActions = useMemo(
    () => getQuickActionsForContext(activeContext.type),
    [activeContext.type]
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? null,
    [currentSessionId, sessions]
  );
  const runs = useMemo(() => {
    if (!currentSessionId) return [];

    const sessionRunIds = new Set(currentSession?.runIds ?? []);
    return sortRunsByCreatedDesc(
      allRuns.filter(
        (run) => run.sessionId === currentSessionId || sessionRunIds.has(run.id)
      )
    );
  }, [allRuns, currentSession, currentSessionId]);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  useEffect(() => {
    if (!runs.length) {
      if (selectedRunId !== null) {
        setSelectedRunId(null);
      }
      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isDrawerOpen || isChatPage) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isChatPage, isDrawerOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      for (const timeoutId of pollTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      pollTimeoutsRef.current.clear();
    };
  }, []);

  const createSession = () => {
    const nextSession = createChatSession();
    setSessions((current) => sortSessionsByUpdatedDesc([nextSession, ...current]));
    setCurrentSessionId(nextSession.id);
    setSelectedRunId(null);
  };

  const selectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setSelectedRunId(null);
  };

  const syncSessionWithRun = (run: AIRunRecord) => {
    if (!run.sessionId) return;

    setSessions((current) => {
      const index = current.findIndex((session) => session.id === run.sessionId);
      if (index === -1) {
        return sortSessionsByUpdatedDesc([
          createChatSession({
            id: run.sessionId,
            title: buildChatSessionTitle(run.prompt),
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            runIds: [run.id],
          }),
          ...current,
        ]);
      }

      const session = current[index];
      const nextSession = {
        ...session,
        title: session.title || buildChatSessionTitle(run.prompt),
        updatedAt: run.updatedAt,
        runIds: session.runIds.includes(run.id)
          ? session.runIds
          : [...session.runIds, run.id],
      };
      const nextSessions = [...current];
      nextSessions[index] = nextSession;
      return sortSessionsByUpdatedDesc(nextSessions);
    });
  };

  const mergeRun = (nextRun: AIRunRecord) => {
    let mergedRun = nextRun;

    setAllRuns((current) => {
      const index = current.findIndex((item) => item.id === nextRun.id);
      if (index === -1) {
        mergedRun = nextRun;
        return [mergedRun, ...current];
      }

      const existingRun = current[index];
      mergedRun = {
        ...existingRun,
        ...nextRun,
        sessionId: nextRun.sessionId ?? existingRun.sessionId,
      };
      const nextRuns = [...current];
      nextRuns[index] = mergedRun;
      return nextRuns;
    });

    syncSessionWithRun(mergedRun);
  };

  const queuePoll = (runId: string) => {
    const existingTimeout = pollTimeoutsRef.current.get(runId);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const nextRun = await adapter.getRun(runId);
        mergeRun(nextRun);

        if (terminalStatuses.has(nextRun.status)) {
          pollTimeoutsRef.current.delete(runId);
          if (nextRun.status === "failed") {
            toast.error(t("toast.aiRunFailed"), {
              description: nextRun.errorMessage ?? t("toast.aiRunFailedDesc"),
            });
          }
          return;
        }

        queuePoll(runId);
      } catch (error) {
        pollTimeoutsRef.current.delete(runId);

        let failedRun: AIRunRecord | null = null;
        setAllRuns((current) =>
          current.map((run) => {
            if (run.id !== runId) {
              return run;
            }

            failedRun = {
              ...run,
              status: "failed",
              errorMessage:
                error instanceof Error ? error.message : t("toast.aiRunFailedDesc"),
              updatedAt: new Date().toISOString(),
            };
            return failedRun;
          })
        );

        if (failedRun) {
          syncSessionWithRun(failedRun);
        }

        toast.error(t("toast.aiRunFailed"), {
          description:
            error instanceof Error ? error.message : t("toast.aiRunFailedDesc"),
        });
      }
    }, 700);

    pollTimeoutsRef.current.set(runId, timeoutId);
  };

  const buildSnapshot = () => {
    const project = activeContext.projectId
      ? projects.find((item) => item.id === activeContext.projectId)
      : undefined;

    return {
      locale: aiResponseLocale,
      interfaceLocale: locale,
      generatedAt: new Date().toISOString(),
      activeContext,
      projects,
      tasks,
      team,
      risks,
      notifications,
      project,
      projectTasks: project ? tasks.filter((task) => task.projectId === project.id) : undefined,
    };
  };

  const ensureActiveSessionId = () => {
    if (currentSessionId && sessions.some((session) => session.id === currentSessionId)) {
      return currentSessionId;
    }

    const nextSession = createChatSession();
    setSessions((current) => sortSessionsByUpdatedDesc([nextSession, ...current]));
    setCurrentSessionId(nextSession.id);
    setSelectedRunId(null);
    return nextSession.id;
  };

  const startRun = async (prompt: string, quickAction?: AIQuickActionDefinition) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (submissionInFlightRef.current) {
      return;
    }

    const contextSnapshot = buildSnapshot();
    const requestedAgentId = quickAction?.agentId ?? selectedAgentId;
    const resolvedAgentId = resolveAgentId(requestedAgentId, contextSnapshot, trimmedPrompt);
    const agent = getAgentById(resolvedAgentId) ?? getAgentById("portfolio-analyst");
    if (!agent) return;

    const now = Date.now();
    const remainingMs = lastRunStartedAtRef.current + MIN_TIME_BETWEEN_RUNS - now;
    if (remainingMs > 0) {
      if (!isChatPage) {
        setIsDrawerOpen(true);
      }
      toast(t("toast.aiRateLimited"), {
        description: t("toast.aiRateLimitedDesc", {
          seconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        }),
      });
      return;
    }

    const sessionId = ensureActiveSessionId();

    lastRunStartedAtRef.current = now;
    submissionInFlightRef.current = true;
    if (!isChatPage) {
      setIsDrawerOpen(true);
    }
    setIsSubmitting(true);

    // Create new abort controller for this run
    abortControllerRef.current = new AbortController();

    try {
      const run = await adapter.runAgent({
        agent,
        prompt: trimmedPrompt,
        context: contextSnapshot,
        quickAction,
        sessionId,
        signal: abortControllerRef.current.signal,
      });

      const nextRun = {
        ...run,
        sessionId,
      };

      mergeRun(nextRun);
      setCurrentSessionId(sessionId);
      setSelectedRunId(nextRun.id);
      queuePoll(nextRun.id);
    } catch (error) {
      // Handle abort error gracefully
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled - no action needed
        return;
      }
      // Handle 503 Service Unavailable (no providers configured)
      const errorWithStatus = error as { status?: number };
      if (errorWithStatus.status === 503) {
        toast.error("AI сервис временно недоступен", {
          description: "Настройте API ключи в настройках"
        });
        return;
      }
      toast.error(t("toast.aiRunFailed"), {
        description:
          error instanceof Error ? error.message : t("toast.aiRunFailedDesc"),
      });
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      abortControllerRef.current = null;
    }
  };

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsSubmitting(false);
      toast.info("Генерация остановлена");
    }
  }, []);

  const regenerateRun = useCallback(async (runId: string) => {
    const run = runs.find(r => r.id === runId);
    if (!run) {
      toast.error("Сообщение не найдено");
      return;
    }

    // Re-run with same prompt
    toast.info("Повторная генерация...");
    await startRun(run.prompt);
  }, [runs]);

  return (
    <AIWorkspaceContext.Provider
      value={{
        adapterMode,
        preferredMode,
        isChatStateReady,
        activeContext,
        agents: aiAgents,
        quickActions,
        sessions,
        currentSession,
        currentSessionId,
        runs,
        selectedRun,
        selectedRunId,
        selectedAgentId,
        isDrawerOpen,
        isSubmitting,
        applyingProposalIds,
        openDrawer: () => setIsDrawerOpen(true),
        closeDrawer: () => setIsDrawerOpen(false),
        createSession,
        selectSession,
        selectRun: setSelectedRunId,
        setPreferredMode,
        setSelectedAgentId,
        submitPrompt: (prompt) => startRun(prompt),
        runQuickAction: async (actionId) => {
          const action = quickActions.find((item) => item.id === actionId);
          if (!action) return;

          await startRun(t(action.promptKey, { context: activeContext.title }), action);
        },
        applyProposal: async (runId, proposalId) => {
          const run = runs.find((item) => item.id === runId);
          const proposal = run?.result?.proposal;
          if (!proposal || proposal.id !== proposalId || proposal.state !== "pending") {
            return;
          }

          setApplyingProposalIds((current) => [...current, proposalId]);
          try {
            const nextRun = await adapter.applyProposal({ runId, proposalId });
            const createdTasks = nextRun.result?.actionResult?.tasksCreated ?? [];
            if (createdTasks.length > 0) {
              addTasksBatch(
                createdTasks.map((task) => ({
                  projectId: task.projectId,
                  title: task.title,
                  description: task.description,
                  assignee: task.assignee,
                  dueDate: task.dueDate,
                  priority: task.priority,
                  tags: ["ai-generated", "proposal"],
                }))
              );
            }
            mergeRun(nextRun);
            toast.success(t("toast.aiProposalApplied"), {
              description:
                nextRun.result?.actionResult?.summary ??
                t("toast.aiProposalAppliedDesc", {
                  count: proposal.tasks.length,
                }),
            });
          } catch (error) {
            toast.error(t("toast.aiRunFailed"), {
              description:
                error instanceof Error ? error.message : t("toast.aiRunFailedDesc"),
            });
          } finally {
            setApplyingProposalIds((current) =>
              current.filter((item) => item !== proposalId)
            );
          }
        },
        dismissProposal: (runId, proposalId) => {
          let updatedRun: AIRunRecord | null = null;
          setAllRuns((current) =>
            current.map((run) => {
              if (run.id !== runId || run.result?.proposal?.id !== proposalId) {
                return run;
              }

              updatedRun = {
                ...run,
                updatedAt: new Date().toISOString(),
                result: {
                  ...run.result,
                  proposal: {
                    ...run.result.proposal,
                    state: "dismissed",
                  },
                },
              };
              return updatedRun;
            })
          );

          if (updatedRun) {
            syncSessionWithRun(updatedRun);
          }
        },
        stopGeneration,
        regenerateRun,
      }}
    >
      {children}
    </AIWorkspaceContext.Provider>
  );
}

export function useAIWorkspace() {
  const context = useContext(AIWorkspaceContext);
  if (!context) {
    throw new Error("useAIWorkspace must be used within AIProvider");
  }

  return context;
}
