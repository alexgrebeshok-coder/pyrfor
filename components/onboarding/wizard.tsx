"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { OnboardingWizardLoadingState, OnboardingWizardView } from "@/components/onboarding/wizard-view";
import { api } from "@/lib/client/api-error";
import { browserStorage, STORAGE_KEYS } from "@/lib/persistence/storage";
import {
  applyOnboardingTemplate,
  buildOnboardingAiPrompt,
  buildOnboardingDashboardState,
  buildOnboardingProjectPayload,
  buildOnboardingTaskPayloads,
  buildOnboardingTeamPayloads,
  createInitialOnboardingDraft,
  createPersistedOnboardingState,
  getRoleOptions,
  getTemplateById,
  loadOnboardingState,
  markOnboardingComplete,
  saveOnboardingState,
  type OnboardingDraft,
  type OnboardingRole,
  type OnboardingTemplateId,
} from "@/lib/onboarding";

type TeamMemberResponse = {
  id: string;
  name: string;
  role: string;
  initials?: string | null;
};

type TaskResponse = {
  id: string;
  title: string;
  projectId: string;
};

type AiChatResponse = {
  success?: boolean;
  response?: string;
  error?: string;
  projectId?: string;
};

const STEPS = [
  { id: "role", title: "Роль" },
  { id: "template", title: "Шаблон" },
  { id: "tasks", title: "Стартовые задачи" },
  { id: "budget", title: "Бюджет и сроки" },
  { id: "ai", title: "AI вопрос/ответ" },
] as const;

const MIN_TASKS = 2;
const MAX_TASKS = 3;
const FALLBACK_PROJECT_ID = "onboarding-preview";

export interface OnboardingData {
  mode: "demo" | "production";
  aiProvider: "openrouter" | "zai" | "openai" | "mock";
  apiKey: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isValidIsoDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function buildDraftPreview(draft: OnboardingDraft) {
  return buildOnboardingDashboardState(draft, draft.createdProjectId ?? FALLBACK_PROJECT_ID);
}

export function OnboardingWizard() {
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft>(() => createInitialOnboardingDraft());
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const onboardingComplete = browserStorage.get<boolean>(STORAGE_KEYS.ONBOARDING_COMPLETE, false);

    if (onboardingComplete) {
      router.replace("/");
      return;
    }

    const restored = loadOnboardingState();
    if (restored) {
      setDraft(restored.draft);
      setCurrentStep(clamp(restored.currentStep, 0, STEPS.length - 1));
    } else {
      const initialDraft = createInitialOnboardingDraft();
      setDraft(initialDraft);
      setCurrentStep(0);
      saveOnboardingState(createPersistedOnboardingState(initialDraft, 0));
    }

    setIsHydrated(true);
  }, [router]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    saveOnboardingState(createPersistedOnboardingState(draft, currentStep));
  }, [draft, currentStep, isHydrated]);

  const roleOptions = useMemo(() => getRoleOptions(), []);
  const dashboardPreview = useMemo(() => buildDraftPreview(draft), [draft]);
  const template = useMemo(() => getTemplateById(draft.templateId), [draft.templateId]);
  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const canGoBack = currentStep > 0;
  const isLastStep = currentStep === STEPS.length - 1;
  const taskCount = draft.tasks.length;
  const budgetDelta = draft.plannedBudget - draft.actualBudget;
  const hasAiAnswer = Boolean(draft.aiAnswer?.trim());

  const updateDraft = (updates: Partial<OnboardingDraft>) => {
    setError(null);
    setWarning(null);
    setDraft((previous) => ({ ...previous, ...updates }));
  };

  const updateTask = (index: number, updates: Partial<OnboardingDraft["tasks"][number]>) => {
    setError(null);
    setWarning(null);
    setDraft((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task, taskIndex) => (taskIndex === index ? { ...task, ...updates } : task)),
    }));
  };

  const selectRole = (role: OnboardingRole) => {
    setError(null);
    setWarning(null);
    updateDraft({ role });
  };

  const selectTemplate = (templateId: OnboardingTemplateId) => {
    setError(null);
    setWarning(null);
    setDraft((previous) => applyOnboardingTemplate(previous, templateId));
  };

  const addTask = () => {
    if (draft.tasks.length >= MAX_TASKS) {
      return;
    }

    const templateTasks = getTemplateById(draft.templateId).taskSuggestions;
    const nextTask = templateTasks[draft.tasks.length] ?? templateTasks[templateTasks.length - 1];

    setError(null);
    setWarning(null);
    setDraft((previous) => ({ ...previous, tasks: [...previous.tasks, nextTask] }));
  };

  const removeTask = (index: number) => {
    if (draft.tasks.length <= MIN_TASKS) {
      return;
    }

    setError(null);
    setWarning(null);
    setDraft((previous) => ({
      ...previous,
      tasks: previous.tasks.filter((_, taskIndex) => taskIndex !== index),
    }));
  };

  async function ensureWorkspaceCreated() {
    setIsProvisioning(true);
    try {
      const warnings: string[] = [];
      const teamPayloads = buildOnboardingTeamPayloads(draft);
      const createdTeamIds: string[] = [];
      const existingTeamMembers = await api
        .get<{ team: TeamMemberResponse[] }>("/api/team")
        .catch((teamError) => {
          warnings.push(`Не удалось проверить существующих участников команды: ${errorMessage(teamError)}`);
          return { team: [] as TeamMemberResponse[] };
        });

      for (const payload of teamPayloads) {
        const existingMember = existingTeamMembers.team.find(
          (member) => member.name === payload.name && member.role === payload.role
        );

        if (existingMember) {
          createdTeamIds.push(existingMember.id);
          continue;
        }

        try {
          const createdMember = await api.post<TeamMemberResponse>("/api/team", payload);
          createdTeamIds.push(createdMember.id);
        } catch (teamError) {
          warnings.push(`Команда: ${payload.name} — ${errorMessage(teamError)}`);
        }
      }

      if (createdTeamIds.length === 0) {
        warnings.push("Не удалось создать участников команды — проект будет создан без привязки к teamIds.");
      }

      const projectId = draft.createdProjectId
        ? draft.createdProjectId
        : (await api.post<{ id: string }>("/api/projects", buildOnboardingProjectPayload(draft, createdTeamIds)))
            .id;

      const existingTasksResponse = await api
        .get<{ tasks: TaskResponse[] }>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`)
        .catch((taskError) => {
          warnings.push(`Не удалось проверить существующие задачи: ${errorMessage(taskError)}`);
          return { tasks: [] as TaskResponse[] };
        });

      const existingTaskTitles = new Set(
        existingTasksResponse.tasks.map((task) => task.title.trim().toLowerCase())
      );
      const taskPayloads = buildOnboardingTaskPayloads(draft, projectId, createdTeamIds);

      for (const payload of taskPayloads) {
        if (existingTaskTitles.has(payload.title.trim().toLowerCase())) {
          continue;
        }

        try {
          await api.post<TaskResponse>("/api/tasks", payload);
        } catch (taskError) {
          warnings.push(`Задача: ${payload.title} — ${errorMessage(taskError)}`);
        }
      }

      updateDraft({ createdProjectId: projectId });
      return { projectId, warnings };
    } finally {
      setIsProvisioning(false);
    }
  }

  const handleGenerateAiAnswer = async () => {
    setError(null);
    setWarning(null);
    setIsGenerating(true);

    try {
      const { projectId, warnings: workspaceWarnings } = await ensureWorkspaceCreated();
      if (workspaceWarnings.length > 0) {
        setWarning(workspaceWarnings.join(" • "));
      }

      const prompt = buildOnboardingAiPrompt(draft);
      const response = await api.post<AiChatResponse>("/api/ai/chat", {
        message: prompt,
        messages: [{ role: "user", content: prompt }],
        projectId,
      });

      const answer = response.response?.trim();
      if (!response.success || !answer) {
        throw new Error(response.error || "AI service returned an empty response.");
      }

      updateDraft({ createdProjectId: projectId, aiAnswer: answer });
      saveOnboardingState(
        createPersistedOnboardingState(
          {
            ...draft,
            createdProjectId: projectId,
            aiAnswer: answer,
          },
          currentStep
        )
      );
    } catch (caughtError) {
      setError(errorMessage(caughtError));
      throw caughtError;
    } finally {
      setIsGenerating(false);
    }
  };

  const finishOnboarding = () => {
    markOnboardingComplete();
    browserStorage.remove(STORAGE_KEYS.ONBOARDING);
    router.push("/");
    router.refresh();
  };

  const goNext = async () => {
    if (isLastStep) {
      if (hasAiAnswer) {
        finishOnboarding();
        return;
      }

      await handleGenerateAiAnswer().catch(() => undefined);
      return;
    }

    setCurrentStep((step) => clamp(step + 1, 0, STEPS.length - 1));
  };

  const goBack = () => {
    if (!canGoBack) {
      return;
    }

    setCurrentStep((step) => clamp(step - 1, 0, STEPS.length - 1));
  };

  const stepComplete = [
    Boolean(draft.role),
    draft.projectName.trim().length >= 3,
    draft.tasks.length >= MIN_TASKS &&
      draft.tasks.every((task) => task.title.trim().length > 0 && task.dueInDays > 0),
    isValidIsoDate(draft.startDate) &&
      isValidIsoDate(draft.endDate) &&
      draft.plannedBudget > 0 &&
      new Date(draft.endDate).getTime() > new Date(draft.startDate).getTime(),
    Boolean(draft.aiQuestion.trim()),
  ];

  if (!isHydrated) {
    return <OnboardingWizardLoadingState />;
  }

  return (
    <OnboardingWizardView
      currentStep={currentStep}
      progress={progress}
      steps={STEPS}
      stepComplete={stepComplete}
      draft={draft}
      dashboardPreview={dashboardPreview}
      template={template}
      roleOptions={roleOptions}
      error={error}
      warning={warning}
      taskCount={taskCount}
      budgetDelta={budgetDelta}
      hasAiAnswer={hasAiAnswer}
      canGoBack={canGoBack}
      isLastStep={isLastStep}
      isGenerating={isGenerating}
      isProvisioning={isProvisioning}
      onStepSelect={setCurrentStep}
      onSelectRole={selectRole}
      onSelectTemplate={selectTemplate}
      onUpdateDraft={updateDraft}
      onUpdateTask={updateTask}
      onAddTask={addTask}
      onRemoveTask={removeTask}
      onBack={goBack}
      onNext={goNext}
      onFinish={finishOnboarding}
    />
  );
}
