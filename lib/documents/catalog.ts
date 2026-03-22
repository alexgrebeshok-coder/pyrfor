import type { Project, ProjectDocument } from "@/lib/types";

export type DocumentHubFolderPath = string;

export interface DocumentHubItem {
  id: string;
  title: string;
  summary: string;
  folderPath: DocumentHubFolderPath;
  folderLabel: string;
  sourcePath: string;
  updatedAt: string;
  tags: string[];
  route?: string;
  projectId?: string;
  projectName?: string;
}

export interface DocumentHubFolderNode {
  id: string;
  label: string;
  description: string;
  folderPath: DocumentHubFolderPath;
  children?: DocumentHubFolderNode[];
}

export const documentHubRoots: DocumentHubFolderNode[] = [
  {
    id: "application",
    label: "Документация приложения",
    description: "README, релиз, AI, интеграции и служебные скрипты.",
    folderPath: "application",
    children: [
      {
        id: "application-launch",
        label: "Запуск и релиз",
        description: "Планы запуска, release hub и оперативные заметки по релизу.",
        folderPath: "application/launch",
      },
      {
        id: "application-ai",
        label: "AI и интеграции",
        description: "Локальная модель, gateway, manifests и внешние подключаемые сервисы.",
        folderPath: "application/ai",
      },
      {
        id: "application-tools",
        label: "Инструменты",
        description: "Скрипты и автоматизация вокруг dashboard и отчётности.",
        folderPath: "application/tools",
      },
      {
        id: "application-integrations",
        label: "Подключения",
        description: "GPS, мессенджеры и внешние API-коннекторы.",
        folderPath: "application/integrations",
      },
    ],
  },
  {
    id: "normative",
    label: "Нормативная база",
    description: "Архитектура, стандарты, провайдеры и EVM.",
    folderPath: "normative",
    children: [
      {
        id: "normative-finance",
        label: "Финансы и EVM",
        description: "План-факт, сценарии и Excel-генерация EVM.",
        folderPath: "normative/finance",
      },
      {
        id: "normative-architecture",
        label: "AI-PMO и архитектура",
        description: "Исходные цели, multi-agent и финальная архитектура.",
        folderPath: "normative/architecture",
      },
      {
        id: "normative-providers",
        label: "Провайдеры и модели",
        description: "AI-провайдеры, локальные модели и маршрутизация.",
        folderPath: "normative/providers",
      },
    ],
  },
  {
    id: "project",
    label: "Проектные документы",
    description: "Файлы, связанные с конкретными проектами.",
    folderPath: "project",
  },
  {
    id: "archive",
    label: "Архив",
    description: "Старые материалы, которые всё ещё полезно держать под рукой.",
    folderPath: "archive",
  },
];

const applicationDocs: DocumentHubItem[] = [
  {
    id: "app-readme",
    title: "README.md",
    summary: "Краткая точка входа в CEOClaw, его разделы и операционный контур.",
    folderPath: "application/launch",
    folderLabel: "Запуск и релиз",
    sourcePath: "README.md",
    updatedAt: "2026-03-20",
    tags: ["вход", "приложение"],
    route: "/help",
  },
  {
    id: "app-readme-ai",
    title: "README_AI.md",
    summary: "Режимы AI, локальная модель, gateway и настройка провайдеров.",
    folderPath: "application/ai",
    folderLabel: "AI и интеграции",
    sourcePath: "README_AI.md",
    updatedAt: "2026-03-20",
    tags: ["AI", "локальная модель"],
    route: "/settings/ai",
  },
  {
    id: "app-master-plan",
    title: "ceoclaw-launch-master-plan.md",
    summary: "Канонический мастер-план запуска и finish-line roadmap продукта.",
    folderPath: "application/launch",
    folderLabel: "Запуск и релиз",
    sourcePath: "docs/ceoclaw-launch-master-plan.md",
    updatedAt: "2026-03-20",
    tags: ["release", "план"],
    route: "/release",
  },
  {
    id: "app-release-plan",
    title: "release-ready-plan.md",
    summary: "Чёткая точка завершения: web, desktop, iPhone и release hub.",
    folderPath: "application/launch",
    folderLabel: "Запуск и релиз",
    sourcePath: "docs/release-ready-plan.md",
    updatedAt: "2026-03-20",
    tags: ["release", "desktop", "iphone"],
    route: "/release",
  },
  {
    id: "app-roadmap",
    title: "full-launch-roadmap.md",
    summary: "Дорожная карта до завершения продукта и связанных сессий промптов.",
    folderPath: "application/launch",
    folderLabel: "Запуск и релиз",
    sourcePath: "docs/full-launch-roadmap.md",
    updatedAt: "2026-03-20",
    tags: ["roadmap", "prompts"],
    route: "/release",
  },
  {
    id: "app-desktop",
    title: "desktop-setup.md",
    summary: "Сборка и упаковка desktop shell, release flow и запуск MLX локально.",
    folderPath: "application/launch",
    folderLabel: "Запуск и релиз",
    sourcePath: "docs/desktop-setup.md",
    updatedAt: "2026-03-20",
    tags: ["desktop", "MLX"],
    route: "/release",
  },
  {
    id: "app-mobile",
    title: "mobile-app.md",
    summary: "iPhone shell, PWA-first поведение и dev workflow для мобильной ветки.",
    folderPath: "application/launch",
    folderLabel: "Запуск и релиз",
    sourcePath: "docs/mobile-app.md",
    updatedAt: "2026-03-20",
    tags: ["mobile", "iphone"],
    route: "/release",
  },
  {
    id: "app-integrations",
    title: "integration-platform.md",
    summary: "Manifests для AI провайдеров, GPS и мессенджеров.",
    folderPath: "application/integrations",
    folderLabel: "Подключения",
    sourcePath: "docs/integration-platform.md",
    updatedAt: "2026-03-20",
    tags: ["integrations", "connectors"],
    route: "/integrations",
  },
  {
    id: "app-evm-script",
    title: "generate_evm.py",
    summary: "Скрипт генерации Excel-модели EVM с формулами, сценариями и графиками.",
    folderPath: "application/tools",
    folderLabel: "Инструменты",
    sourcePath: "scripts/generate_evm.py",
    updatedAt: "2026-03-20",
    tags: ["EVM", "script", "tools"],
    route: "/analytics",
  },
];

const normativeDocs: DocumentHubItem[] = [
  {
    id: "norm-ai-gap",
    title: "ai-pmo-severoavtodor-origin-gap-analysis.md",
    summary: "Разбор исходных целей AI-PMO и текущее соответствие CEOClaw.",
    folderPath: "normative/architecture",
    folderLabel: "AI-PMO и архитектура",
    sourcePath: "docs/ai-pmo-severoavtodor-origin-gap-analysis.md",
    updatedAt: "2026-03-20",
    tags: ["архитектура", "gap analysis"],
    route: "/portfolio",
  },
  {
    id: "norm-ai-providers",
    title: "AI_PROVIDERS_INTEGRATION_PLAN.md",
    summary: "План интеграции AI провайдеров и маршрутизации моделей.",
    folderPath: "normative/providers",
    folderLabel: "Провайдеры и модели",
    sourcePath: "docs/AI_PROVIDERS_INTEGRATION_PLAN.md",
    updatedAt: "2026-03-20",
    tags: ["AI", "providers"],
    route: "/settings/ai",
  },
  {
    id: "norm-russian-ai",
    title: "RUSSIAN_AI_PROVIDERS.md",
    summary: "Список и особенности русскоязычных AI провайдеров.",
    folderPath: "normative/providers",
    folderLabel: "Провайдеры и модели",
    sourcePath: "docs/RUSSIAN_AI_PROVIDERS.md",
    updatedAt: "2026-03-20",
    tags: ["AI", "локальные провайдеры"],
    route: "/settings/ai",
  },
  {
    id: "norm-glm5",
    title: "glm5-desktop-iphone-plan.md",
    summary: "Согласованный план для desktop и iPhone с учётом finish-line.",
    folderPath: "normative/architecture",
    folderLabel: "AI-PMO и архитектура",
    sourcePath: "docs/glm5-desktop-iphone-plan.md",
    updatedAt: "2026-03-20",
    tags: ["desktop", "iphone"],
    route: "/release",
  },
  {
    id: "norm-prompts",
    title: "multi-agent-launch-prompts.md",
    summary: "Набор подсказок для мультиагентных сессий и stage-based работы.",
    folderPath: "normative/architecture",
    folderLabel: "AI-PMO и архитектура",
    sourcePath: "docs/multi-agent-launch-prompts.md",
    updatedAt: "2026-03-20",
    tags: ["multi-agent", "prompts"],
    route: "/chat",
  },
  {
    id: "norm-evm-plan",
    title: "EVM-INTEGRATION-DASHBOARD.md",
    summary: "План интеграции генератора EVM-модели и dashboard-ветки.",
    folderPath: "normative/finance",
    folderLabel: "Финансы и EVM",
    sourcePath: "memory/EVM-INTEGRATION-DASHBOARD.md",
    updatedAt: "2026-03-20",
    tags: ["EVM", "finance", "dashboard"],
    route: "/analytics",
  },
];

function formatProjectDocument(
  document: ProjectDocument,
  projectName: string | undefined,
  projectDirection: Project["direction"] | undefined,
  projectLocation: string | undefined
): DocumentHubItem {
  return {
    id: `project-${document.id}`,
    title: document.title,
    summary: [document.type, document.owner, projectLocation ?? projectName ?? document.projectId]
      .filter(Boolean)
      .join(" · "),
    folderPath: `project/${document.projectId}`,
    folderLabel: projectName ? `Проект: ${projectName}` : "Проект",
    sourcePath: `project/${document.projectId}/${document.title}`,
    updatedAt: document.updatedAt,
    tags: [document.type, projectDirection ?? "project"],
    route: `/projects/${document.projectId}`,
    projectId: document.projectId,
    projectName,
  };
}

export function buildDocumentHubItems(
  documents: ProjectDocument[],
  projects: Project[]
): DocumentHubItem[] {
  const projectLookup = new Map(projects.map((project) => [project.id, project]));

  return [
    ...applicationDocs,
    ...normativeDocs,
    ...documents.map((document) => {
      const project = projectLookup.get(document.projectId);
      return formatProjectDocument(document, project?.name, project?.direction, project?.location);
    }),
  ];
}

export function buildDocumentHubTree(
  projects: Project[],
  items: DocumentHubItem[]
): DocumentHubFolderNode[] {
  const projectNodes = projects
    .filter((project) => items.some((item) => item.folderPath === `project/${project.id}`))
    .map((project) => ({
      id: `project-${project.id}`,
      label: project.name,
      description: [project.location, project.direction].filter(Boolean).join(" · "),
      folderPath: `project/${project.id}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return documentHubRoots.map((node) =>
    node.id === "project" ? { ...node, children: projectNodes } : node
  );
}

export function countByFolderPath(items: DocumentHubItem[], folderPath: DocumentHubFolderPath | "all") {
  if (folderPath === "all") {
    return items.length;
  }

  const normalizedPrefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;

  return items.filter(
    (item) => item.folderPath === folderPath || item.folderPath.startsWith(normalizedPrefix)
  ).length;
}
