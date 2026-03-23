import { addDays, format, parseISO } from "date-fns";

import { browserStorage, STORAGE_KEYS } from "@/lib/persistence/storage";
import type {
  DashboardState,
  Milestone,
  Priority,
  Project,
  ProjectDirection,
  ProjectDocument,
  Risk,
  Task,
  TeamMember,
  UserRole,
} from "@/lib/types";

export type OnboardingRole = UserRole;
export type OnboardingTemplateId = "construction" | "software" | "consulting" | "marketing" | "universal";
export type OnboardingCurrency = "RUB" | "USD" | "EUR";

export interface OnboardingTaskDraft {
  title: string;
  priority: Priority;
  dueInDays: number;
}

export interface OnboardingDraft {
  role: OnboardingRole;
  templateId: OnboardingTemplateId;
  projectName: string;
  projectDescription: string;
  startDate: string;
  endDate: string;
  plannedBudget: number;
  actualBudget: number;
  currency: OnboardingCurrency;
  tasks: OnboardingTaskDraft[];
  aiQuestion: string;
  createdProjectId?: string;
  aiAnswer?: string;
}

export interface OnboardingPersistedState {
  currentStep: number;
  draft: OnboardingDraft;
  updatedAt: string;
  completedAt?: string;
}

export interface OnboardingRoleOption {
  value: OnboardingRole;
  label: string;
  description: string;
}

export interface OnboardingTemplate {
  id: OnboardingTemplateId;
  label: string;
  summary: string;
  direction: ProjectDirection;
  defaultProjectName: string;
  defaultProjectDescription: string;
  defaultPriority: Priority;
  plannedBudget: number;
  actualBudget: number;
  currency: OnboardingCurrency;
  durationDays: number;
  location: string;
  aiFocus: string;
  objectives: string[];
  taskSuggestions: [OnboardingTaskDraft, OnboardingTaskDraft, OnboardingTaskDraft];
  riskTitle: string;
  riskMitigation: string;
}

export interface OnboardingTeamSpec {
  name: string;
  role: string;
  email: string;
  initials: string;
  capacity: number;
}

export type OnboardingTeamPayload = OnboardingTeamSpec;

export interface OnboardingProjectPayload {
  name: string;
  description?: string;
  direction: ProjectDirection;
  status: "planning" | "active";
  priority: Priority;
  start: string;
  end: string;
  budgetPlan: number;
  budgetFact: number;
  progress: number;
  health: "good";
  location: string;
  teamIds?: string[];
}

export interface OnboardingTaskPayload {
  title: string;
  description?: string;
  projectId: string;
  dueDate: string;
  status: "todo";
  priority: Priority;
  order: number;
  assigneeId?: string | null;
}

const ROLE_OPTIONS: OnboardingRoleOption[] = [
  {
    value: "EXEC",
    label: "Руководитель",
    description: "Портфель, деньги, риск и решения",
  },
  {
    value: "PM",
    label: "PM / Руководитель проекта",
    description: "План, статусы, блокеры и срок",
  },
  {
    value: "CURATOR",
    label: "Куратор",
    description: "Координация и контроль исполнения",
  },
  {
    value: "MEMBER",
    label: "Специалист",
    description: "Личные задачи и быстрые статусы",
  },
  {
    value: "SOLO",
    label: "Solo / консультант",
    description: "Личный кокпит и быстрая аналитика",
  },
];

export const ONBOARDING_TEMPLATES: OnboardingTemplate[] = [
  {
    id: "construction",
    label: "Строительство",
    summary: "Площадка, подрядчики, поставки и план-факт.",
    direction: "construction",
    defaultProjectName: "Строительный объект",
    defaultProjectDescription: "Контроль сроков, поставок и бюджета на стройплощадке.",
    defaultPriority: "high",
    plannedBudget: 18_500_000,
    actualBudget: 2_450_000,
    currency: "RUB",
    durationDays: 120,
    location: "Стройплощадка",
    aiFocus: "график работ, поставки материалов, план-факт и эскалации",
    objectives: [
      "Стабилизировать график и поставки.",
      "Показать отклонения до того, как они станут критичными.",
      "Давать руководителю короткий и точный next step.",
    ],
    taskSuggestions: [
      {
        title: "Сверить график критического пути",
        priority: "high",
        dueInDays: 2,
      },
      {
        title: "Проверить поставки материалов",
        priority: "medium",
        dueInDays: 5,
      },
      {
        title: "Подготовить план-факт сводку",
        priority: "high",
        dueInDays: 7,
      },
    ],
    riskTitle: "Срыв поставки материалов",
    riskMitigation: "Задать резервного поставщика и окно эскалации.",
  },
  {
    id: "software",
    label: "IT / Software",
    summary: "Релизы, баги, спринты и блокеры доставки.",
    direction: "trade",
    defaultProjectName: "Release 2.4 — Customer Portal",
    defaultProjectDescription: "Управление релизом, блокерами и готовностью команды к запуску.",
    defaultPriority: "high",
    plannedBudget: 3_600_000,
    actualBudget: 420_000,
    currency: "RUB",
    durationDays: 45,
    location: "Гибридная команда",
    aiFocus: "спринт, релиз, блокеры и дата запуска",
    objectives: [
      "Собрать текущие блокеры по релизу.",
      "Показать, что успеем выпустить в срок.",
      "Свести статус команды в один экран.",
    ],
    taskSuggestions: [
      {
        title: "Зафиксировать scope релиза",
        priority: "high",
        dueInDays: 1,
      },
      {
        title: "Собрать блокеры команды",
        priority: "medium",
        dueInDays: 3,
      },
      {
        title: "Проверить готовность к запуску",
        priority: "high",
        dueInDays: 5,
      },
    ],
    riskTitle: "Сдвиг даты релиза",
    riskMitigation: "Заморозить scope и убрать неключевые задачи.",
  },
  {
    id: "consulting",
    label: "Консалтинг",
    summary: "Клиентский scope, deliverables и статус пилота.",
    direction: "trade",
    defaultProjectName: "Клиентский пилот",
    defaultProjectDescription: "Пилотный проект с коротким циклом обратной связи и отчётности.",
    defaultPriority: "medium",
    plannedBudget: 1_200_000,
    actualBudget: 180_000,
    currency: "RUB",
    durationDays: 30,
    location: "Клиентский офис",
    aiFocus: "scope, клиентский статус и readiness к следующей встрече",
    objectives: [
      "Согласовать ожидания клиента и команды.",
      "Подсветить риски до weekly review.",
      "Дать понятный статус следующего шага.",
    ],
    taskSuggestions: [
      {
        title: "Согласовать scope пилота",
        priority: "high",
        dueInDays: 2,
      },
      {
        title: "Подготовить клиентский статус",
        priority: "medium",
        dueInDays: 4,
      },
      {
        title: "Собрать feedback и next steps",
        priority: "medium",
        dueInDays: 6,
      },
    ],
    riskTitle: "Разрыв ожиданий клиента",
    riskMitigation: "Зафиксировать критерии успеха и владельцев deliverables.",
  },
  {
    id: "marketing",
    label: "Маркетинг",
    summary: "Кампании, лиды, бюджеты и контент-ритм.",
    direction: "trade",
    defaultProjectName: "Campaign Launch Q2",
    defaultProjectDescription: "Управление запуском кампании, бюджетом и результатами по лидам.",
    defaultPriority: "medium",
    plannedBudget: 900_000,
    actualBudget: 120_000,
    currency: "RUB",
    durationDays: 21,
    location: "Маркетинговая команда",
    aiFocus: "кампании, лиды, бюджет и контент-план",
    objectives: [
      "Собрать контент-план и каналы.",
      "Показать, какие активности дают лиды.",
      "Следить за бюджетом и конверсией.",
    ],
    taskSuggestions: [
      {
        title: "Утвердить контент-план",
        priority: "high",
        dueInDays: 1,
      },
      {
        title: "Сверить бюджет кампаний",
        priority: "medium",
        dueInDays: 3,
      },
      {
        title: "Подготовить отчёт по лидам",
        priority: "high",
        dueInDays: 5,
      },
    ],
    riskTitle: "Перерасход рекламного бюджета",
    riskMitigation: "Ввести лимиты и дневной контроль расходов.",
  },
  {
    id: "universal",
    label: "Универсальный",
    summary: "Одна рабочая зона для любых задач и отчётов.",
    direction: "trade",
    defaultProjectName: "Pilot Workspace",
    defaultProjectDescription: "Быстрый старт для любой команды без привязки к отрасли.",
    defaultPriority: "medium",
    plannedBudget: 2_400_000,
    actualBudget: 240_000,
    currency: "RUB",
    durationDays: 60,
    location: "Удалённо / офис",
    aiFocus: "статусы, риски и следующий шаг",
    objectives: [
      "Создать понятный первый проект без сложной настройки.",
      "Сразу показать, какие 2–3 шага делать дальше.",
      "Собрать универсальный cockpit для команды.",
    ],
    taskSuggestions: [
      {
        title: "Собрать первый статус",
        priority: "high",
        dueInDays: 2,
      },
      {
        title: "Проверить риски и блокеры",
        priority: "medium",
        dueInDays: 4,
      },
      {
        title: "Согласовать следующий шаг",
        priority: "high",
        dueInDays: 6,
      },
    ],
    riskTitle: "Нет общего статуса по проекту",
    riskMitigation: "Ввести ежедневный короткий update и владельца статуса.",
  },
];

export function getRoleOptions(): OnboardingRoleOption[] {
  return ROLE_OPTIONS;
}

export function getRoleLabel(role: OnboardingRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

export function getTemplateById(templateId: OnboardingTemplateId): OnboardingTemplate {
  return ONBOARDING_TEMPLATES.find((template) => template.id === templateId) ?? ONBOARDING_TEMPLATES[ONBOARDING_TEMPLATES.length - 1];
}

export function createInitialOnboardingDraft(
  role: OnboardingRole = "PM",
  templateId: OnboardingTemplateId = "universal"
): OnboardingDraft {
  return createOnboardingDraftFromTemplate(getTemplateById(templateId), role);
}

export function createOnboardingDraftFromTemplate(
  template: OnboardingTemplate,
  role: OnboardingRole
): OnboardingDraft {
  const today = new Date();
  const startDate = format(today, "yyyy-MM-dd");
  const endDate = format(addDays(today, template.durationDays), "yyyy-MM-dd");

  return {
    role,
    templateId: template.id,
    projectName: template.defaultProjectName,
    projectDescription: template.defaultProjectDescription,
    startDate,
    endDate,
    plannedBudget: template.plannedBudget,
    actualBudget: template.actualBudget,
    currency: template.currency,
    tasks: template.taskSuggestions.map((task) => ({ ...task })),
    aiQuestion: `Что нам нужно сделать в ближайшие 2 недели для шаблона «${template.label}»?`,
  };
}

export function applyOnboardingTemplate(
  currentDraft: OnboardingDraft,
  templateId: OnboardingTemplateId
): OnboardingDraft {
  const template = getTemplateById(templateId);
  const nextDraft = createOnboardingDraftFromTemplate(template, currentDraft.role);

  return {
    ...currentDraft,
    templateId: template.id,
    projectName: nextDraft.projectName,
    projectDescription: nextDraft.projectDescription,
    startDate: nextDraft.startDate,
    endDate: nextDraft.endDate,
    plannedBudget: nextDraft.plannedBudget,
    actualBudget: nextDraft.actualBudget,
    currency: nextDraft.currency,
    tasks: nextDraft.tasks,
    aiQuestion: nextDraft.aiQuestion,
    createdProjectId: undefined,
    aiAnswer: undefined,
  };
}

export function getOnboardingRoleSummary(role: OnboardingRole): string {
  switch (role) {
    case "EXEC":
      return "Портфель и решения";
    case "PM":
      return "План, статусы и блокеры";
    case "CURATOR":
      return "Координация и контроль";
    case "MEMBER":
      return "Личные задачи и исполнение";
    case "SOLO":
      return "Личный cockpit";
    default:
      return role;
  }
}

export function formatOnboardingCurrency(value: number, currency: OnboardingCurrency): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function getOnboardingTaskDueDate(startDate: string, dueInDays: number): string {
  return format(addDays(parseISO(startDate), dueInDays), "yyyy-MM-dd");
}

export function buildOnboardingProjectPayload(
  draft: OnboardingDraft,
  teamIds: string[] = []
): OnboardingProjectPayload {
  const template = getTemplateById(draft.templateId);

  return {
    name: draft.projectName.trim(),
    description: draft.projectDescription.trim() || template.defaultProjectDescription,
    direction: template.direction,
    status: "active",
    priority: template.defaultPriority,
    start: draft.startDate,
    end: draft.endDate,
    budgetPlan: draft.plannedBudget,
    budgetFact: draft.actualBudget,
    progress: 18,
    health: "good",
    location: template.location,
    teamIds,
  };
}

export function buildOnboardingTeamPayloads(draft: OnboardingDraft): OnboardingTeamPayload[] {
  const roleLabel = getRoleLabel(draft.role);
  const template = getTemplateById(draft.templateId);

  const leadRole =
    template.id === "marketing"
      ? "Креативный лидер"
      : template.id === "software"
        ? "Delivery lead"
        : template.id === "construction"
          ? "Производственный координатор"
          : template.id === "consulting"
            ? "Клиентский lead"
            : "Операционный lead";

  return [
    {
      name: `${template.label} ${leadRole}`,
      role: `${roleLabel} / ${leadRole}`,
      email: `${template.id}.lead@ceoclaw.local`,
      initials: template.label.slice(0, 2).toUpperCase(),
      capacity: 100,
    },
    {
      name: "Координатор исполнения",
      role: `${template.label} coordinator`,
      email: `${template.id}.coord@ceoclaw.local`,
      initials: "КР",
      capacity: 85,
    },
    {
      name: "Финансовый контроль",
      role: "Finance control",
      email: `${template.id}.finance@ceoclaw.local`,
      initials: "ФН",
      capacity: 70,
    },
  ];
}

export function buildOnboardingTeamSpecs(draft: OnboardingDraft): OnboardingTeamSpec[] {
  return buildOnboardingTeamPayloads(draft);
}

export function buildOnboardingTaskPayloads(
  draft: OnboardingDraft,
  projectId: string,
  assigneeIds: string[] = []
): OnboardingTaskPayload[] {
  const template = getTemplateById(draft.templateId);

  return draft.tasks.map((task, index) => ({
    title: task.title.trim(),
    description: `${template.label}: ${task.title.trim()}`,
    projectId,
    dueDate: getOnboardingTaskDueDate(draft.startDate, task.dueInDays),
    status: "todo",
    priority: task.priority,
    order: index,
    assigneeId: assigneeIds.length ? assigneeIds[index % assigneeIds.length] : undefined,
  }));
}

export function buildOnboardingAiPrompt(draft: OnboardingDraft): string {
  const template = getTemplateById(draft.templateId);
  const budgetDelta = draft.plannedBudget - draft.actualBudget;
  const taskLines = draft.tasks
    .map(
      (task, index) =>
        `${index + 1}. ${task.title} — срок ${task.dueInDays} дн., приоритет ${task.priority}`
    )
    .join("\n");

  return [
    `Ты — практичный AI-ассистент CEOClaw. Дай короткий и полезный ответ пользователю в роли "${getRoleLabel(draft.role)}".`,
    `Проект: "${draft.projectName}" (${template.label}).`,
    `Контекст: ${draft.projectDescription}`,
    `Бюджет: план ${formatOnboardingCurrency(draft.plannedBudget, draft.currency)}, факт ${formatOnboardingCurrency(draft.actualBudget, draft.currency)}, отклонение ${formatOnboardingCurrency(budgetDelta, draft.currency)}.`,
    `Фокус шаблона: ${template.aiFocus}.`,
    `Задачи:\n${taskLines}`,
    `Вопрос пользователя: ${draft.aiQuestion.trim() || "Какие первые действия нужны прямо сейчас?"}`,
    "Ответь по структуре:",
    "1. Что сейчас главное.",
    "2. Какой риск самый заметный.",
    "3. Что сделать сегодня.",
    "4. На какой показатель смотреть дальше.",
    "Пиши по-русски, кратко и без воды.",
  ].join("\n");
}

export function buildOnboardingDashboardState(
  draft: OnboardingDraft,
  projectId = draft.createdProjectId ?? `onboarding-${draft.templateId}`
): DashboardState {
  const template = getTemplateById(draft.templateId);
  const roleLabel = getRoleLabel(draft.role);
  const teamSpecs = buildOnboardingTeamPayloads(draft);
  const team: TeamMember[] = teamSpecs.map((member, index) => ({
    id: `${projectId}-team-${index + 1}`,
    name: member.name,
    role: member.role,
    email: member.email,
    capacity: member.capacity,
    allocated: Math.max(20, 30 + index * 15),
    projects: [draft.projectName],
    location: template.location,
  }));
  const taskAssignees = teamSpecs.map((member, index) => ({
    id: team[index]?.id ?? `${projectId}-team-${index + 1}`,
    name: member.name,
    initials: member.initials,
  }));
  const project: Project = {
    id: projectId,
    name: draft.projectName,
    description: draft.projectDescription,
    status: "active",
    progress: 18,
    direction: template.direction,
    budget: {
      planned: draft.plannedBudget,
      actual: draft.actualBudget,
      currency: draft.currency,
    },
    dates: { start: draft.startDate, end: draft.endDate },
    nextMilestone: {
      name: "Первый review",
      date: format(addDays(parseISO(draft.startDate), 7), "yyyy-MM-dd"),
    },
    team: team.map((member) => member.name),
    risks: 1,
    location: template.location,
    priority: template.defaultPriority,
    health: 82,
    objectives: template.objectives,
    materials: 48,
    laborProductivity: 71,
    safety: { ltifr: 0.2, trir: 0.6 },
    history: [
      {
        date: draft.startDate,
        progress: 12,
        budgetPlanned: Math.round(draft.plannedBudget * 0.12),
        budgetActual: Math.round(draft.actualBudget * 0.8),
      },
      {
        date: format(new Date(), "yyyy-MM-dd"),
        progress: 18,
        budgetPlanned: Math.round(draft.plannedBudget * 0.33),
        budgetActual: draft.actualBudget,
      },
    ],
  };

  const tasks: Task[] = draft.tasks.map((task, index) => ({
    id: `${projectId}-task-${index + 1}`,
    projectId,
    title: task.title,
    description: `${template.label}. ${task.title}`,
    status: index === 0 ? "in-progress" : "todo",
    order: index,
    assignee: taskAssignees[index % taskAssignees.length] ?? null,
    dueDate: getOnboardingTaskDueDate(draft.startDate, task.dueInDays),
    priority: task.priority,
    tags: [template.label, "onboarding"],
    createdAt: draft.startDate,
  }));

  const risks: Risk[] = [
    {
      id: `${projectId}-risk-1`,
      projectId,
      title: template.riskTitle,
      description: template.riskMitigation,
      ownerId: team[0]?.id ?? null,
      owner: team[0]?.name ?? roleLabel,
      probability: 3,
      impact: 4,
      status: "open",
      mitigation: template.riskMitigation,
      category: template.label,
    },
  ];

  const milestones: Milestone[] = [
    {
      id: `${projectId}-milestone-1`,
      projectId,
      name: "Kickoff",
      start: draft.startDate,
      end: format(addDays(parseISO(draft.startDate), 7), "yyyy-MM-dd"),
      status: "planning",
      progress: 18,
    },
    {
      id: `${projectId}-milestone-2`,
      projectId,
      name: "First checkpoint",
      start: format(addDays(parseISO(draft.startDate), 7), "yyyy-MM-dd"),
      end: format(addDays(parseISO(draft.startDate), 21), "yyyy-MM-dd"),
      status: "active",
      progress: 42,
    },
  ];

  const documents: ProjectDocument[] = [
    {
      id: `${projectId}-doc-1`,
      projectId,
      title: "Onboarding brief",
      type: "brief",
      owner: team[0]?.name ?? roleLabel,
      updatedAt: draft.startDate,
      size: "24 KB",
    },
  ];

  return {
    projects: [project],
    tasks,
    team,
    risks,
    documents,
    milestones,
    currentUser: {
      id: "onboarding-user",
      name: roleLabel,
      role: draft.role,
      email: "you@ceoclaw.local",
    },
    auditLogEntries: [
      {
        id: `${projectId}-audit-1`,
        projectId,
        action: "onboarding_completed",
        userId: "onboarding-user",
        userName: roleLabel,
        timestamp: format(new Date(), "yyyy-MM-dd'T'HH:mm:ssxxx"),
        details: `Selected ${template.label} template and seeded ${tasks.length} starter task(s).`,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeDraft(rawDraft: unknown): OnboardingDraft | null {
  if (!isRecord(rawDraft)) {
    return null;
  }

  if (
    typeof rawDraft.role === "string" &&
    typeof rawDraft.templateId === "string" &&
    typeof rawDraft.projectName === "string" &&
    typeof rawDraft.projectDescription === "string" &&
    typeof rawDraft.startDate === "string" &&
    typeof rawDraft.endDate === "string" &&
    typeof rawDraft.plannedBudget === "number" &&
    typeof rawDraft.actualBudget === "number" &&
    typeof rawDraft.currency === "string" &&
    Array.isArray(rawDraft.tasks)
  ) {
    return {
      role: rawDraft.role as OnboardingRole,
      templateId: rawDraft.templateId as OnboardingTemplateId,
      projectName: rawDraft.projectName,
      projectDescription: rawDraft.projectDescription,
      startDate: rawDraft.startDate,
      endDate: rawDraft.endDate,
      plannedBudget: rawDraft.plannedBudget,
      actualBudget: rawDraft.actualBudget,
      currency: rawDraft.currency as OnboardingCurrency,
      tasks: rawDraft.tasks
        .filter(isRecord)
        .map((task) => ({
          title: typeof task.title === "string" ? task.title : "Новая задача",
          priority: (task.priority as Priority) ?? "medium",
          dueInDays: typeof task.dueInDays === "number" ? task.dueInDays : 3,
        })),
      aiQuestion:
        typeof rawDraft.aiQuestion === "string"
          ? rawDraft.aiQuestion
          : `Что нам нужно сделать в ближайшие 2 недели для шаблона «${getTemplateById(rawDraft.templateId as OnboardingTemplateId).label}»?`,
      createdProjectId:
        typeof rawDraft.createdProjectId === "string" ? rawDraft.createdProjectId : undefined,
      aiAnswer: typeof rawDraft.aiAnswer === "string" ? rawDraft.aiAnswer : undefined,
    };
  }

  return null;
}

export function createPersistedOnboardingState(
  draft: OnboardingDraft,
  currentStep = 0
): OnboardingPersistedState {
  return {
    currentStep,
    draft,
    updatedAt: new Date().toISOString(),
  };
}

export function loadOnboardingState(): OnboardingPersistedState | null {
  const rawState = browserStorage.get<unknown>(STORAGE_KEYS.ONBOARDING);
  if (!rawState) {
    return null;
  }

  if (isRecord(rawState) && "draft" in rawState && "currentStep" in rawState) {
    const draft = normalizeDraft(rawState.draft);
    if (!draft) {
      return null;
    }

    return {
      currentStep:
        typeof rawState.currentStep === "number" ? rawState.currentStep : 0,
      draft: {
        ...draft,
        aiQuestion: draft.aiQuestion,
      },
      updatedAt:
        typeof rawState.updatedAt === "string" ? rawState.updatedAt : new Date().toISOString(),
      completedAt:
        typeof rawState.completedAt === "string" ? rawState.completedAt : undefined,
    };
  }

  const legacyDraft = normalizeDraft(rawState);
  if (legacyDraft) {
    return createPersistedOnboardingState(legacyDraft, 0);
  }

  return null;
}

export function saveOnboardingState(state: OnboardingPersistedState): void {
  browserStorage.set(STORAGE_KEYS.ONBOARDING, state);
}

export function clearOnboardingState(): void {
  browserStorage.remove(STORAGE_KEYS.ONBOARDING);
  browserStorage.remove(STORAGE_KEYS.ONBOARDING_COMPLETE);
}

export function markOnboardingComplete(): void {
  browserStorage.set(STORAGE_KEYS.ONBOARDING_COMPLETE, true);
}
