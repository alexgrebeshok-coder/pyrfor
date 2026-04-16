import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  Car,
  CircleHelp,
  Columns3,
  FileText,
  LayoutDashboard,
  LineChart,
  MapPinned,
  MessageSquareText,
  NotebookText,
  Package,
  Search,
  Flag,
  Target,
  Rocket,
  Settings2,
  Sparkles,
  Siren,
  Truck,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { stripDemoWorkspacePrefix } from "@/lib/demo/workspace-paths";
import { type MessageKey } from "@/lib/translations";
import type { Project } from "@/lib/types";

export interface NavigationItem {
  href: string;
  icon: LucideIcon;
  label?: string;
  labelKey?: MessageKey;
}

export interface NavigationSection {
  id: string;
  label?: string;
  labelKey?: MessageKey;
  description?: string;
  descriptionKey?: MessageKey;
  items: NavigationItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface OperationsSection {
  id: string;
  label?: string;
  labelKey?: MessageKey;
  description?: string;
  descriptionKey?: MessageKey;
  items: NavigationItem[];
}

export const operationsSections: OperationsSection[] = [
  {
    id: "data",
    labelKey: "sidebar.section.operations",
    descriptionKey: "sidebar.section.operationsDescription",
    items: [
      { href: "/field-operations", label: "Поля и логистика", icon: MapPinned },
      { href: "/expenses", labelKey: "nav.expenses", icon: Wallet },
      { href: "/equipment", labelKey: "nav.equipment", icon: Truck },
      { href: "/materials", labelKey: "nav.materials", icon: Package },
      { href: "/suppliers", labelKey: "nav.suppliers", icon: BriefcaseBusiness },
      { href: "/contracts", labelKey: "nav.contracts", icon: FileText },
      { href: "/meetings", labelKey: "nav.meetings", icon: MessageSquareText },
      { href: "/command-center", labelKey: "nav.commandCenter", icon: AlertTriangle },
      { href: "/briefs", labelKey: "nav.briefs", icon: FileText },
    ],
  },
];

export const navigationSections: NavigationSection[] = [
  {
    id: "main",
    labelKey: "sidebar.section.overview",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/projects", labelKey: "nav.projects", icon: BriefcaseBusiness },
      { href: "/tasks", labelKey: "nav.tasks", icon: Workflow },
      { href: "/portfolio", labelKey: "nav.portfolio", icon: Target },
      { href: "/goals", labelKey: "nav.goals", icon: Flag },
    ],
  },
  {
    id: "analytics",
    labelKey: "sidebar.section.planning",
    items: [
      { href: "/kanban", labelKey: "nav.kanban", icon: Columns3 },
      { href: "/calendar", labelKey: "nav.calendar", icon: CalendarDays },
      { href: "/gantt", labelKey: "nav.gantt", icon: LineChart },
      { href: "/analytics", labelKey: "nav.analytics", icon: Sparkles },
      { href: "/autobusiness", labelKey: "nav.autobusiness", icon: Car },
      { href: "/finance", labelKey: "nav.finance", icon: Wallet },
      { href: "/resources", labelKey: "nav.resources", icon: Truck },
    ],
  },
  {
    id: "team",
    labelKey: "sidebar.section.team",
    items: [
      { href: "/team", labelKey: "nav.team", icon: Users },
      { href: "/risks", labelKey: "nav.risks", icon: AlertTriangle },
    ],
  },
  {
    id: "documents",
    labelKey: "sidebar.section.documents",
    descriptionKey: "sidebar.section.documentsDescription",
    items: [
      { href: "/documents", labelKey: "nav.documents", icon: FileText },
      { href: "/search", labelKey: "nav.search", icon: Search },
    ],
  },
  {
    id: "ai",
    labelKey: "sidebar.section.ai",
    items: [
      { href: "/chat", labelKey: "nav.chat", icon: MessageSquareText },
    ],
  },
];

// Keep for backward compatibility
export const navigation: NavigationItem[] = [
  { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/projects", labelKey: "nav.projects", icon: BriefcaseBusiness },
  { href: "/tasks", labelKey: "nav.tasks", icon: Workflow },
  { href: "/portfolio", labelKey: "nav.portfolio", icon: Target },
  { href: "/goals", label: "Цели", icon: Target },
  { href: "/kanban", labelKey: "nav.kanban", icon: Columns3 },
  { href: "/calendar", labelKey: "nav.calendar", icon: CalendarDays },
  { href: "/gantt", labelKey: "nav.gantt", icon: LineChart },
  { href: "/analytics", labelKey: "nav.analytics", icon: Sparkles },
  { href: "/autobusiness", labelKey: "nav.autobusiness", icon: Car },
  { href: "/finance", labelKey: "nav.finance", icon: Wallet },
  { href: "/resources", labelKey: "nav.resources", icon: Truck },
  { href: "/team", labelKey: "nav.team", icon: Users },
  { href: "/risks", labelKey: "nav.risks", icon: AlertTriangle },
  { href: "/expenses", labelKey: "nav.expenses", icon: Wallet },
  { href: "/equipment", labelKey: "nav.equipment", icon: Truck },
  { href: "/materials", labelKey: "nav.materials", icon: Package },
  { href: "/suppliers", labelKey: "nav.suppliers", icon: BriefcaseBusiness },
  { href: "/contracts", labelKey: "nav.contracts", icon: FileText },
  { href: "/documents", labelKey: "nav.documents", icon: FileText },
  { href: "/search", labelKey: "nav.search", icon: Search },
  { href: "/chat", labelKey: "nav.chat", icon: MessageSquareText },
];

export const operationsNavigation: NavigationItem[] = [
  { href: "/field-operations", label: "Поля и логистика", icon: MapPinned },
  { href: "/meetings", labelKey: "nav.meetings", icon: CalendarClock },
  { href: "/command-center", labelKey: "nav.commandCenter", icon: Siren },
  { href: "/briefs", labelKey: "nav.briefs", icon: NotebookText },
];

export const footerNavigation: NavigationItem[] = [
  { href: "/release", labelKey: "nav.downloads", icon: Rocket },
  { href: "/settings", labelKey: "nav.settings", icon: Settings2 },
  { href: "/help", labelKey: "nav.help", icon: CircleHelp },
];

export interface ResolvedTitle {
  eyebrow?: string;
  eyebrowKey?: MessageKey;
  title?: string;
  titleKey?: MessageKey;
}

const localizedPageTitles: Record<string, ResolvedTitle> = {
  "/": { eyebrowKey: "page.dashboard.eyebrow", titleKey: "page.dashboard.title" },
  "/projects": { eyebrowKey: "page.projects.eyebrow", titleKey: "page.projects.title" },
  "/tasks": { eyebrowKey: "page.tasks.eyebrow", titleKey: "page.tasks.title" },
  "/portfolio": { eyebrowKey: "page.portfolio.eyebrow", titleKey: "page.portfolio.title" },
  "/goals": { eyebrow: "Управленческий контур", title: "Цели и OKR" },
  "/kanban": { eyebrowKey: "page.kanban.eyebrow", titleKey: "page.kanban.title" },
  "/calendar": { eyebrowKey: "page.calendar.eyebrow", titleKey: "page.calendar.title" },
  "/gantt": { eyebrowKey: "page.gantt.eyebrow", titleKey: "page.gantt.title" },
  "/analytics": { eyebrowKey: "page.analytics.eyebrow", titleKey: "page.analytics.title" },
  "/finance": { eyebrowKey: "page.finance.eyebrow", titleKey: "page.finance.title" },
  "/autobusiness": { eyebrowKey: "autobusiness.eyebrow", titleKey: "autobusiness.title" },
  "/resources": { eyebrowKey: "page.resources.eyebrow", titleKey: "page.resources.title" },
  "/team": { eyebrowKey: "page.team.eyebrow", titleKey: "page.team.title" },
  "/risks": { eyebrowKey: "page.risks.eyebrow", titleKey: "page.risks.title" },
  "/expenses": { eyebrowKey: "page.expenses.eyebrow", titleKey: "page.expenses.title" },
  "/equipment": { eyebrowKey: "page.equipment.eyebrow", titleKey: "page.equipment.title" },
  "/materials": { eyebrowKey: "page.materials.eyebrow", titleKey: "page.materials.title" },
  "/suppliers": { eyebrowKey: "page.suppliers.eyebrow", titleKey: "page.suppliers.title" },
  "/contracts": { eyebrowKey: "page.contracts.eyebrow", titleKey: "page.contracts.title" },
  "/chat": { eyebrowKey: "page.chat.eyebrow", titleKey: "page.chat.title" },
  "/settings": { eyebrowKey: "page.settings.eyebrow", titleKey: "page.settings.title" },
  "/help": { eyebrowKey: "page.help.eyebrow", titleKey: "page.help.title" },
  "/imports": { eyebrow: "Ввод данных", title: "Импорт" },
  "/briefs": { eyebrowKey: "page.briefs.eyebrow", titleKey: "page.briefs.title" },
  "/meetings": { eyebrowKey: "page.meetings.eyebrow", titleKey: "page.meetings.title" },
  "/command-center": { eyebrowKey: "page.commandCenter.eyebrow", titleKey: "page.commandCenter.title" },
  "/search": { eyebrow: "Быстрый поиск", title: "Поиск" },
  "/release": { eyebrowKey: "page.release.eyebrow", titleKey: "page.release.title" },
  "/audit-packs": { eyebrow: "Готовность к аудиту", title: "Аудиторские пакеты" },
  "/pilot-controls": { eyebrow: "Готовность к выкатке", title: "Пилотные настройки" },
  "/pilot-feedback": { eyebrow: "Цикл обратной связи", title: "Обратная связь пилота" },
  "/tenant-readiness": { eyebrow: "Готовность к запуску", title: "Готовность среды" },
  "/tenant-onboarding": { eyebrow: "Развёртывание", title: "Запуск среды" },
  "/tenant-rollout-packet": { eyebrow: "Пакет развёртывания", title: "Пакет запуска среды" },
  "/pilot-review": { eyebrow: "Проверка пилота", title: "Обзор пилота" },
  "/work-reports": { eyebrow: "Цикл поставки", title: "Рабочие отчёты" },
  "/integrations": { eyebrow: "Платформенное доверие", title: "Состояние коннекторов" },
  "/field-operations": { eyebrow: "Полевой контур", title: "Поля и логистика" },
  "/documents": { eyebrow: "База знаний", title: "Документы" },
};

export function resolveTitle(pathname: string | null): ResolvedTitle {
  const safePathname = stripDemoWorkspacePrefix(pathname ?? "/");

  if (safePathname.startsWith("/projects/")) {
    return {
      eyebrowKey: "page.project.eyebrow",
      titleKey: "page.project.title",
    };
  }

  if (safePathname.startsWith("/goals/")) {
    return localizedPageTitles["/goals"];
  }

  if (safePathname.startsWith("/imports/")) {
    return localizedPageTitles["/imports"];
  }

  if (safePathname.startsWith("/briefs/")) {
    return localizedPageTitles["/briefs"];
  }

  if (safePathname.startsWith("/meetings/")) {
    return localizedPageTitles["/meetings"];
  }

  if (safePathname.startsWith("/command-center/")) {
    return localizedPageTitles["/command-center"];
  }

  if (safePathname.startsWith("/audit-packs/")) {
    return localizedPageTitles["/audit-packs"];
  }

  if (safePathname.startsWith("/pilot-controls/")) {
    return localizedPageTitles["/pilot-controls"];
  }

  if (safePathname.startsWith("/pilot-feedback/")) {
    return localizedPageTitles["/pilot-feedback"];
  }

  if (safePathname.startsWith("/tenant-readiness/")) {
    return localizedPageTitles["/tenant-readiness"];
  }

  if (safePathname.startsWith("/tenant-onboarding/")) {
    return localizedPageTitles["/tenant-onboarding"];
  }

  if (safePathname.startsWith("/tenant-rollout-packet/")) {
    return localizedPageTitles["/tenant-rollout-packet"];
  }

  if (safePathname.startsWith("/pilot-review/")) {
    return localizedPageTitles["/pilot-review"];
  }

  if (safePathname.startsWith("/work-reports/")) {
    return localizedPageTitles["/work-reports"];
  }

  if (safePathname.startsWith("/integrations/")) {
    return localizedPageTitles["/integrations"];
  }

  if (safePathname.startsWith("/field-operations/")) {
    return localizedPageTitles["/field-operations"];
  }

  return localizedPageTitles[safePathname as keyof typeof localizedPageTitles] ?? localizedPageTitles["/"];
}

export function getProjectTone(status: Project["status"]): string {
  switch (status) {
    case "active":
      return "bg-emerald-500";
    case "planning":
      return "bg-sky-500";
    case "completed":
      return "bg-violet-500";
    case "at-risk":
      return "bg-rose-500";
    default:
      return "bg-amber-500";
  }
}
