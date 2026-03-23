"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareText,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client/api-error";
import { browserStorage, STORAGE_KEYS } from "@/lib/persistence/storage";
import {
  ONBOARDING_TEMPLATES,
  applyOnboardingTemplate,
  buildOnboardingAiPrompt,
  buildOnboardingDashboardState,
  buildOnboardingProjectPayload,
  buildOnboardingTaskPayloads,
  buildOnboardingTeamPayloads,
  createInitialOnboardingDraft,
  createPersistedOnboardingState,
  getRoleLabel,
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

const DEFAULT_QUESTION =
  "Что нам важно контролировать в первую очередь и какие 3 шага помогут стартовать без риска?";

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

function formatDateInput(value: string) {
  return value.slice(0, 10);
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
      tasks: previous.tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...updates } : task
      ),
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
        : (await api.post<{ id: string }>(
            "/api/projects",
            buildOnboardingProjectPayload(draft, createdTeamIds)
          )).id;

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
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_35%),linear-gradient(180deg,_var(--surface),_var(--surface))] flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Загружаем onboarding</CardTitle>
            <CardDescription>Восстанавливаем ваш прогресс из localStorage.</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={45} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_35%),linear-gradient(180deg,_var(--surface),_var(--surface))] text-[var(--ink)]">
      <header className="border-b border-[var(--line)]/70 bg-[color:rgba(255,255,255,0.55)] backdrop-blur supports-[backdrop-filter]:bg-[color:rgba(255,255,255,0.45)] dark:bg-[color:rgba(10,12,16,0.48)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
                  <Rocket className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">CEOClaw Onboarding</h1>
                  <p className="text-sm text-[var(--ink-muted)]">
                    Быстрый старт: роль → шаблон → задачи → бюджет → AI.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-panel)] px-3 py-2 text-sm text-[var(--ink-muted)] shadow-sm">
              <span>
                Шаг {currentStep + 1} / {STEPS.length}
              </span>
              <span aria-hidden="true">•</span>
              <span>{STEPS[currentStep]?.title}</span>
            </div>
          </div>

          <Progress value={progress} className="h-2" />

          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {STEPS.map((step, index) => {
              const active = index === currentStep;
              const done = index < currentStep || (index === currentStep && stepComplete[index]);

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStep(index)}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                    active
                      ? "border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/30"
                      : done
                        ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                        : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-blue-300"
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                      active
                        ? "bg-blue-600 text-white"
                        : done
                          ? "bg-emerald-600 text-white"
                          : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--ink)]">{step.title}</div>
                    <div className="text-xs text-[var(--ink-muted)]">
                      {active ? "Текущий этап" : done ? "Готово" : "Следующий"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)] lg:px-8">
        <section className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-[var(--line)]/70 bg-[var(--surface-muted)]/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{STEPS[currentStep].title}</CardTitle>
                  <CardDescription>
                    {currentStep === 0 && "Выберите управленческую роль для будущего workspace."}
                    {currentStep === 1 && "Подберите проектный шаблон — он задаст направление, бюджет и сроки."}
                    {currentStep === 2 && "Соберите 2–3 стартовые задачи, чтобы команда начала с ясного плана."}
                    {currentStep === 3 && "Уточните бюджет и timeline — эти данные попадут в проект сразу."}
                    {currentStep === 4 && "Сформулируйте вопрос к AI и получите ответ с учетом выбранного контекста."}
                  </CardDescription>
                </div>
                <Badge variant="info" className="gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Lite onboarding
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
                  {error}
                </div>
              )}

              {warning && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {warning}
                </div>
              )}

              {currentStep === 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {roleOptions.map((roleOption) => {
                    const selected = draft.role === roleOption.value;

                    return (
                      <button
                        key={roleOption.value}
                        type="button"
                        onClick={() => selectRole(roleOption.value)}
                        className={`rounded-2xl border p-4 text-left transition-all ${
                          selected
                            ? "border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/30"
                            : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-blue-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-base font-semibold text-[var(--ink)]">{roleOption.label}</div>
                            <div className="mt-1 text-sm text-[var(--ink-muted)]">{roleOption.description}</div>
                          </div>
                          <Badge variant={selected ? "success" : "neutral"}>
                            {selected ? "Выбрано" : getRoleLabel(roleOption.value)}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentStep === 1 && (
                <div className="grid gap-3 lg:grid-cols-2">
                  {ONBOARDING_TEMPLATES.map((templateOption) => {
                    const selected = draft.templateId === templateOption.id;

                    return (
                      <button
                        key={templateOption.id}
                        type="button"
                        onClick={() => selectTemplate(templateOption.id)}
                        className={`rounded-2xl border p-4 text-left transition-all ${
                          selected
                            ? "border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/30"
                            : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-blue-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold">{templateOption.label}</div>
                            <div className="mt-1 text-sm text-[var(--ink-muted)]">{templateOption.summary}</div>
                          </div>
                          <Badge variant={selected ? "success" : "neutral"}>
                            {selected ? "Активен" : templateOption.direction}
                          </Badge>
                        </div>
                        <div className="mt-4 grid gap-2 text-sm text-[var(--ink-muted)] sm:grid-cols-2">
                          <div className="rounded-xl bg-[var(--surface-muted)]/60 px-3 py-2">
                            <div className="text-xs uppercase tracking-wide">Бюджет</div>
                            <div className="font-medium text-[var(--ink)]">
                              {templateOption.plannedBudget.toLocaleString("ru-RU")} {templateOption.currency}
                            </div>
                          </div>
                          <div className="rounded-xl bg-[var(--surface-muted)]/60 px-3 py-2">
                            <div className="text-xs uppercase tracking-wide">Срок</div>
                            <div className="font-medium text-[var(--ink)]">{templateOption.durationDays} дней</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-[var(--ink-muted)]">
                      Настройте список стартовых задач: сейчас <span className="font-medium text-[var(--ink)]">{taskCount}</span>.
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addTask} disabled={taskCount >= MAX_TASKS}>
                      <Plus className="h-4 w-4" />
                      Добавить задачу
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {draft.tasks.map((task, index) => (
                      <div key={`${task.title}-${index}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink-muted)]">
                            <ClipboardList className="h-4 w-4" />
                            Задача {index + 1}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeTask(index)}
                            disabled={draft.tasks.length <= MIN_TASKS}
                          >
                            <Trash2 className="h-4 w-4" />
                            Удалить
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
                          <div className="space-y-2">
                            <Label htmlFor={`task-title-${index}`}>Название</Label>
                            <Input
                              id={`task-title-${index}`}
                              value={task.title}
                              onChange={(event) => updateTask(index, { title: event.target.value })}
                              placeholder="Например: Зафиксировать scope релиза"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`task-due-${index}`}>Срок, дней</Label>
                            <Input
                              id={`task-due-${index}`}
                              type="number"
                              min={1}
                              max={30}
                              value={task.dueInDays}
                              onChange={(event) =>
                                updateTask(index, {
                                  dueInDays: clamp(Number(event.target.value || 0), 1, 30),
                                })
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`task-priority-${index}`}>Приоритет</Label>
                            <select
                              id={`task-priority-${index}`}
                              value={task.priority}
                              onChange={(event) =>
                                updateTask(index, {
                                  priority: event.target.value as OnboardingDraft["tasks"][number]["priority"],
                                })
                              }
                              className="h-10 w-full rounded-lg border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-blue-500"
                            >
                              <option value="low">Низкий</option>
                              <option value="medium">Средний</option>
                              <option value="high">Высокий</option>
                              <option value="critical">Критичный</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)]/40 p-4 text-sm text-[var(--ink-muted)]">
                    AI предложит ответ уже на основе этих 2–3 задач. Задачи можно менять до финального шага.
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="project-name">Название проекта</Label>
                      <Input
                        id="project-name"
                        value={draft.projectName}
                        onChange={(event) => updateDraft({ projectName: event.target.value })}
                        placeholder="Например: Release 2.4 — Customer Portal"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="project-description">Описание</Label>
                      <textarea
                        id="project-description"
                        value={draft.projectDescription}
                        onChange={(event) => updateDraft({ projectDescription: event.target.value })}
                        rows={5}
                        className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-blue-500"
                        placeholder="Коротко опишите цель проекта и результат"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="start-date">Дата старта</Label>
                        <Input
                          id="start-date"
                          type="date"
                          value={formatDateInput(draft.startDate)}
                          onChange={(event) => updateDraft({ startDate: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end-date">Дата завершения</Label>
                        <Input
                          id="end-date"
                          type="date"
                          value={formatDateInput(draft.endDate)}
                          onChange={(event) => updateDraft({ endDate: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="planned-budget">Плановый бюджет</Label>
                        <Input
                          id="planned-budget"
                          type="number"
                          min={0}
                          step={1000}
                          value={draft.plannedBudget}
                          onChange={(event) => updateDraft({ plannedBudget: Number(event.target.value || 0) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="actual-budget">Фактический бюджет</Label>
                        <Input
                          id="actual-budget"
                          type="number"
                          min={0}
                          step={1000}
                          value={draft.actualBudget}
                          onChange={(event) => updateDraft({ actualBudget: Number(event.target.value || 0) })}
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                      <div className="flex items-center justify-between text-sm text-[var(--ink-muted)]">
                        <span>Бюджетный разрыв</span>
                        <span className={budgetDelta >= 0 ? "text-emerald-600" : "text-rose-600"}>
                          {budgetDelta >= 0 ? "+" : ""}
                          {budgetDelta.toLocaleString("ru-RU")} {draft.currency}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm text-[var(--ink-muted)]">
                        <span>Срок</span>
                        <span>
                          {draft.startDate} → {draft.endDate}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 4 && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="ai-question">Вопрос к AI</Label>
                      <textarea
                        id="ai-question"
                        value={draft.aiQuestion}
                        onChange={(event) => updateDraft({ aiQuestion: event.target.value, aiAnswer: undefined })}
                        rows={5}
                        className="min-h-32 w-full rounded-2xl border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-blue-500"
                        placeholder={DEFAULT_QUESTION}
                      />
                    </div>

                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--ink-muted)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={draft.createdProjectId ? "success" : "neutral"} className="gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {draft.createdProjectId ? "Workspace создан" : "Workspace ещё не создан"}
                        </Badge>
                        <Badge variant={hasAiAnswer ? "success" : "neutral"}>
                          {hasAiAnswer ? "Ответ готов" : "Ответ ожидается"}
                        </Badge>
                      </div>
                      <p className="mt-3 leading-relaxed">
                        AI получит контекст роли, шаблона, задач, бюджета и вопрос пользователя.
                        Если workspace ещё не создан, CEOClaw создаст team → project → tasks автоматически.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {draft.aiAnswer ? (
                      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30">
                        <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-100">
                          <MessageSquareText className="h-4 w-4" />
                          Ответ AI
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-emerald-900 dark:text-emerald-50">
                          {draft.aiAnswer}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)]/40 p-4 text-sm text-[var(--ink-muted)]">
                        После генерации ответ появится здесь. Можно вернуться и скорректировать вопрос до завершения onboarding.
                      </div>
                    )}

                    <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--ink-muted)]">
                      <div className="flex items-center gap-2 text-[var(--ink)]">
                        <WandSparkles className="h-4 w-4 text-blue-600" />
                        Что отправим в AI prompt
                      </div>
                      <ul className="mt-3 space-y-2">
                        <li>• Роль: {getRoleLabel(draft.role)}</li>
                        <li>• Шаблон: {template.label}</li>
                        <li>• Задач: {draft.tasks.length}</li>
                        <li>• Бюджет: {draft.plannedBudget.toLocaleString("ru-RU")} {draft.currency}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Live preview</CardTitle>
              <CardDescription>
                Локальная DashboardState-подсказка на основе текущего draft.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-[var(--ink-muted)]">Роль</div>
                    <div className="font-semibold">{getRoleLabel(draft.role)}</div>
                  </div>
                  <Badge variant="info">{template.label}</Badge>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2 text-sm text-[var(--ink-muted)]">
                  <div className="flex items-center justify-between gap-3">
                    <span>Проект</span>
                    <span className="font-medium text-[var(--ink)]">{draft.projectName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Бюджет</span>
                    <span className="font-medium text-[var(--ink)]">
                      {draft.plannedBudget.toLocaleString("ru-RU")} {draft.currency}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Срок</span>
                    <span className="font-medium text-[var(--ink)]">
                      {draft.startDate} → {draft.endDate}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>AI вопрос</span>
                    <span className="ml-4 max-w-[180px] text-right font-medium text-[var(--ink)]">
                      {draft.aiQuestion || "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                  <Users className="h-4 w-4 text-blue-600" />
                  Команда
                </div>
                <div className="mt-3 space-y-2">
                  {dashboardPreview.team.map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--ink)]">{member.name}</div>
                        <div className="truncate text-[var(--ink-muted)]">{member.role}</div>
                      </div>
                      <Badge variant="neutral">{member.capacity}%</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                  <ClipboardList className="h-4 w-4 text-blue-600" />
                  Задачи
                </div>
                <div className="mt-3 space-y-2">
                  {dashboardPreview.tasks.map((task) => (
                    <div key={task.id} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--ink)]">{task.title}</div>
                        <div className="truncate text-[var(--ink-muted)]">{task.assignee?.name ?? "Без исполнителя"}</div>
                      </div>
                      <Badge variant="neutral">{task.priority}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              {draft.createdProjectId && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-50">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Workspace уже создан
                  </div>
                  <p className="mt-2 leading-relaxed">
                    Project ID: <span className="font-mono text-xs">{draft.createdProjectId}</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Что произойдёт дальше</CardTitle>
              <CardDescription>Пошагово создаём рабочее пространство из выбранного draft.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[var(--ink-muted)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-[var(--ink)]">Team members</div>
                  <p>Создаем несколько участников команды через /api/team.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Rocket className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-[var(--ink)]">Project</div>
                  <p>Собираем project payload и подставляем созданные teamIds.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-[var(--ink)]">Starter tasks</div>
                  <p>Создаем 2–3 стартовые задачи с assigneeIds, если участники доступны.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <MessageSquareText className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-[var(--ink)]">AI answer</div>
                  <p>Отправляем prompt в /api/ai/chat с projectId, если он уже создан.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>

      <footer className="border-t border-[var(--line)]/70 bg-[color:rgba(255,255,255,0.55)] backdrop-blur supports-[backdrop-filter]:bg-[color:rgba(255,255,255,0.45)] dark:bg-[color:rgba(10,12,16,0.48)]">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <Button variant="ghost" onClick={goBack} disabled={!canGoBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>

          {!isLastStep ? (
            <Button onClick={goNext} className="gap-2" disabled={!stepComplete[currentStep]}>
              Далее
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : hasAiAnswer ? (
            <Button onClick={finishOnboarding} className="gap-2" disabled={isProvisioning || isGenerating}>
              <CheckCircle2 className="h-4 w-4" />
              Завершить onboarding
            </Button>
          ) : (
            <Button
              onClick={goNext}
              className="gap-2"
              disabled={!stepComplete[currentStep] || isGenerating || isProvisioning}
            >
              {isGenerating || isProvisioning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создаем workspace…
                </>
              ) : (
                <>
                  <WandSparkles className="h-4 w-4" />
                  Создать workspace и получить ответ
                </>
              )}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
