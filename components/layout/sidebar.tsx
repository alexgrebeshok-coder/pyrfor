"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { useDashboard } from "@/components/dashboard-provider";
import {
  footerNavigation,
  getProjectTone,
  operationsSections,
  navigationSections,
  type NavigationItem,
} from "@/components/layout/navigation-config";
import { Input } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { usePreferences } from "@/contexts/preferences-context";
import { useRisks, useTasks } from "@/lib/hooks/use-api";
import { type MessageKey } from "@/lib/translations";
import { cn } from "@/lib/utils";

const WORKSPACE_COLLAPSED_STORAGE_KEY = "ceoclaw-sidebar-workspace-collapsed";

export function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const { projects, risks: cachedRisks, tasks: cachedTasks, documents: cachedDocuments } = useDashboard();
  const { risks: liveRisks, isLoading: risksLoading } = useRisks();
  const { tasks: liveTasks, isLoading: tasksLoading } = useTasks();
  const { activeWorkspace, availableWorkspaces, setWorkspaceId } = usePreferences();
  const { t } = useLocale();
  const workspaceProjects = useMemo(() => {
    switch (activeWorkspace.id) {
      case "delivery":
        return projects.filter(
          (project) => project.status === "active" || project.status === "at-risk"
        );
      case "strategy":
        return projects.filter(
          (project) =>
            project.status === "planning" ||
            project.status === "on-hold" ||
            project.priority === "critical"
        );
      default:
        return projects;
    }
  }, [activeWorkspace.id, projects]);
  const featuredProjects = workspaceProjects.slice(0, 3);
  const documentCount = cachedDocuments.length;
  const totalRiskCount =
    liveRisks.length > 0 || !risksLoading ? liveRisks.length : cachedRisks.length;
  const totalTaskCount =
    liveTasks.length > 0 || !tasksLoading ? liveTasks.length : cachedTasks.length;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(WORKSPACE_COLLAPSED_STORAGE_KEY);
      if (stored !== null) {
        setWorkspaceCollapsed(stored !== "false");
      }
    } catch {
      // Ignore storage failures; default compact mode is still usable.
    }

    const focusSearch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    window.addEventListener("ceoclaw:focus-search", focusSearch);
    return () => window.removeEventListener("ceoclaw:focus-search", focusSearch);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        WORKSPACE_COLLAPSED_STORAGE_KEY,
        workspaceCollapsed ? "true" : "false"
      );
    } catch {
      // Ignore storage failures.
    }
  }, [workspaceCollapsed]);

  const handleSearch = (): void => {
    if (!search.trim()) return;
    onNavigate?.();
    router.push(`/search?q=${encodeURIComponent(search.trim())}`);
  };

  const getItemLabel = (item: NavigationItem): string =>
    item.label ?? (item.labelKey ? t(item.labelKey) : item.href);

  const getSectionLabel = (section: { label?: string; labelKey?: MessageKey }): string =>
    section.label ?? (section.labelKey ? t(section.labelKey) : "");

  const getSectionDescription = (section: { description?: string; descriptionKey?: MessageKey }): string | undefined =>
    section.description ?? (section.descriptionKey ? t(section.descriptionKey) : undefined);

  const renderNavItem = (item: NavigationItem, badgeValue?: number, compact = false) => {
    const Icon = item.icon;
    const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
    
    return (
      <Link
        key={item.href}
        className={cn(
          "app-shell-nav-link group flex items-center gap-2 rounded-md text-sm font-medium text-[var(--ink-soft)] no-underline transition hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]",
          compact ? "px-2 py-1.5 text-[12px]" : "px-3 py-2",
          active && "bg-[var(--brand)] text-white hover:bg-[var(--brand)] hover:text-white"
        )}
        href={item.href}
        onClick={onNavigate}
      >
        <Icon className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <span className="min-w-0 flex-1 truncate">{getItemLabel(item)}</span>
        {badgeValue && badgeValue > 0 ? (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              active
                ? "bg-white/20 text-white"
                : "bg-[var(--panel-soft)] text-[var(--brand)]"
            )}
          >
            {badgeValue}
          </span>
        ) : null}
      </Link>
    );
  };

  const getBadgeValue = (href: string): number | undefined => {
    switch (href) {
      case "/tasks":
        return totalTaskCount;
      case "/risks":
        return totalRiskCount;
      case "/documents":
        return documentCount;
      default:
        return undefined;
    }
  };
  const operationsLabel = t("sidebar.section.operations");

  return (
    <div
      className="app-shell-sidebar-content app-shell-scroll-region flex h-full min-h-0 flex-col overflow-y-auto text-[var(--ink)]"
      style={{
        background: "linear-gradient(180deg,var(--surface-sidebar-start) 0%, var(--surface-sidebar-end) 100%)",
        boxShadow: "var(--sidebar-shadow)",
      }}
    >
      {/* Workspace Selector */}
      <div className="rounded-md border border-[var(--line)] bg-[var(--panel-soft)] p-1.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {t("sidebar.workspace")}
            </p>
            {!workspaceCollapsed ? (
              <p className="mt-0.5 text-[9px] leading-4 text-[var(--ink-soft)]">
                {t("sidebar.workspaceHint")}
              </p>
            ) : null}
          </div>
          <button
            aria-label={workspaceCollapsed ? t("sidebar.workspaceExpand") : t("sidebar.workspaceCollapse")}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface-panel)] text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            onClick={() => setWorkspaceCollapsed((current) => !current)}
            type="button"
          >
            {workspaceCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        {workspaceCollapsed ? (
          <button
            aria-label={`${t("sidebar.workspace")} ${t(activeWorkspace.nameKey as MessageKey)}`}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition",
              "border-[var(--line)] bg-[var(--surface-panel)] text-[var(--ink)] hover:border-[var(--line-strong)]"
            )}
            onClick={() => setWorkspaceCollapsed(false)}
            type="button"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--brand)] text-sm font-semibold text-white"
              aria-hidden="true"
            >
              {activeWorkspace.initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[var(--ink)]">
                {t(activeWorkspace.nameKey as MessageKey)}
              </p>
              <p className="truncate text-[9px] leading-4 text-[var(--ink-soft)]">
                {t("sidebar.workspaceCurrent")}
              </p>
            </div>
          </button>
        ) : (
          <div className="grid gap-1">
            {availableWorkspaces.map((workspace) => {
              const active = workspace.id === activeWorkspace.id;

              return (
                <button
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition",
                    active
                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--ink)]"
                      : "border-transparent text-[var(--ink-soft)] hover:border-[var(--line)] hover:bg-[var(--surface-panel)]"
                  )}
                  key={workspace.id}
                  onClick={() => setWorkspaceId(workspace.id)}
                  type="button"
                >
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
                      active
                        ? "bg-[var(--brand)] text-white"
                        : "bg-[var(--brand)]/15 text-[var(--brand)]"
                    )}
                  >
                    {workspace.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[var(--ink)]">
                      {t(workspace.nameKey as MessageKey)}
                    </p>
                    <p className="truncate text-[9px] leading-4 text-[var(--ink-soft)]">
                      {t(workspace.descriptionKey as MessageKey)}
                    </p>
                  </div>
                  {active ? (
                    <span className="shrink-0 rounded-full border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--brand)]">
                      {t("sidebar.workspaceCurrent")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
        <Input
          aria-label={t("topbar.searchPlaceholder")}
          className="border-[var(--line-strong)] bg-[var(--panel-soft)] pl-10 pr-14"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSearch();
          }}
          placeholder={t("topbar.searchPlaceholder")}
          ref={searchRef}
          value={search}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-sm bg-[var(--kbd-surface)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
          ⌘K
        </span>
      </div>

      {/* Main Navigation - Always Visible */}
      <nav className="grid gap-3" role="navigation" aria-label="Main navigation">
        {navigationSections.map((section) => (
          <section key={section.id} className="grid gap-1.5">
            <div className="px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {getSectionLabel(section)}
              </p>
              {getSectionDescription(section) ? (
                <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-[var(--ink-soft)]">
                  {getSectionDescription(section)}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1" role="group">
              {section.items.map((item) => renderNavItem(item, getBadgeValue(item.href), true))}
            </div>
          </section>
        ))}

        <section className="grid gap-1.5">
          <div className="px-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {operationsLabel}
            </p>
            <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-[var(--ink-soft)]">
              {t("sidebar.section.operationsDescription")}
            </p>
          </div>
          <div className="grid gap-2" role="group">
            {operationsSections.map((section) => (
              <div key={section.id} className="grid gap-1">
                {getSectionLabel(section) !== operationsLabel ? (
                  <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                    {getSectionLabel(section)}
                  </p>
                ) : null}
                <div className="grid gap-1">
                  {section.items.map((item) => renderNavItem(item, getBadgeValue(item.href), true))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </nav>

      {/* Featured Projects */}
      <div className="mt-2">
        <p className="px-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          {t("sidebar.projectsTitle")}
        </p>
      </div>

      <div className="grid gap-1">
        {featuredProjects.length ? (
          featuredProjects.map((project) => {
            const active = pathname === `/projects/${project.id}`;
            return (
              <Link
                className={cn(
                  "app-shell-project-link flex min-w-0 items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]",
                  active && "bg-[var(--panel-soft)] text-[var(--ink)]"
                )}
                href={`/projects/${project.id}`}
                key={project.id}
                onClick={onNavigate}
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", getProjectTone(project.status))} />
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {project.name}
                </span>
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">{project.progress}%</span>
              </Link>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-[var(--line)] px-3 py-4 text-sm text-[var(--ink-muted)]">
            {t("sidebar.noProjects")}
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="mt-auto grid gap-2 pt-2">
        <div className="grid gap-1">
          {footerNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-[var(--ink-soft)] no-underline transition hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]",
                  active && "bg-[var(--panel-soft)] text-[var(--ink)]"
                )}
                href={item.href}
                key={item.href}
                onClick={onNavigate}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="flex-1">{getItemLabel(item)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
