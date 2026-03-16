"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, LayoutDashboard, ListTodo, Users2, BarChart3, Calendar, GanttChart, AlertTriangle, Settings, Bell, Search, Briefcase, ChevronDown, Database, Shield, Rocket } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";

import { useDashboard } from "@/components/dashboard-provider";
import {
  footerNavigation,
  getProjectTone,
  navigation,
  operationsSections,
  type NavigationItem,
} from "@/components/layout/navigation-config";
import { Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocale } from "@/contexts/locale-context";
import { usePreferences } from "@/contexts/preferences-context";
import { useRisks, useTasks } from "@/lib/hooks/use-api";
import { type MessageKey } from "@/lib/translations";
import { cn } from "@/lib/utils";

function moveMenuFocus(container: HTMLDivElement | null, direction: 1 | -1): void {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-workspace-item]"));
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + items.length) % items.length;
  items[nextIndex]?.focus();
}

export function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const workspaceItemsRef = useRef<HTMLDivElement | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    planning: true,
    team: true,
    ops: true,
    opsData: true,
    opsGovernance: true,
    opsRollout: true,
    portfolio: false,
  });
  const { projects, risks: cachedRisks, tasks: cachedTasks } = useDashboard();
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
  const totalRiskCount =
    liveRisks.length > 0 || !risksLoading ? liveRisks.length : cachedRisks.length;
  const totalTaskCount =
    liveTasks.length > 0 || !tasksLoading ? liveTasks.length : cachedTasks.length;
  const activeProjectCount = workspaceProjects.filter((project) => project.status === "active").length;
  const atRiskProjectCount = workspaceProjects.filter((project) => project.status === "at-risk").length;
  const portfolioHealth = workspaceProjects.length
    ? Math.round(
        workspaceProjects.reduce((sum, project) => sum + project.health, 0) / workspaceProjects.length
      )
    : 0;

  useEffect(() => {
    const focusSearch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    window.addEventListener("ceoclaw:focus-search", focusSearch);
    return () => window.removeEventListener("ceoclaw:focus-search", focusSearch);
  }, []);

  const handleSearch = (): void => {
    if (!search.trim()) return;
    onNavigate?.();
    router.push(`/projects?query=${encodeURIComponent(search.trim())}`);
  };

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getItemLabel = (item: NavigationItem): string =>
    item.label ?? (item.labelKey ? t(item.labelKey) : item.href);

  const renderNavItem = (item: NavigationItem, badgeValue?: number, compact = false) => {
    const Icon = item.icon;
    const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
    
    return (
      <Link
        key={item.href}
        className={cn(
          "app-shell-nav-link group flex items-center gap-3 rounded-md text-sm font-medium text-[var(--ink-soft)] transition hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]",
          compact ? "px-3 py-2" : "px-4 py-2.5",
          active && "bg-[var(--brand)] text-white hover:bg-[var(--brand)] hover:text-white"
        )}
        href={item.href}
        onClick={onNavigate}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{getItemLabel(item)}</span>
        {badgeValue && badgeValue > 0 ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
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

  return (
    <div
      className="app-shell-sidebar-content app-shell-scroll-region flex h-full min-h-0 flex-col overflow-y-auto text-[var(--ink)]"
      style={{
        background: "linear-gradient(180deg,var(--surface-sidebar-start) 0%, var(--surface-sidebar-end) 100%)",
        boxShadow: "var(--sidebar-shadow)",
      }}
    >
      {/* Workspace Selector */}
      <Popover onOpenChange={setWorkspaceOpen} open={workspaceOpen}>
        <PopoverTrigger asChild>
          <button
            aria-haspopup="menu"
            className="flex w-full items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-left"
            type="button"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-[var(--brand)] text-sm font-semibold text-white">
              {activeWorkspace.initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {t("sidebar.workspace")}
              </p>
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                {t(activeWorkspace.nameKey as MessageKey)}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 text-[var(--ink-muted)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[calc(var(--sidebar-width)-1.5rem)] max-w-[calc(100vw-2rem)] p-1.5"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveMenuFocus(workspaceItemsRef.current, 1);
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              moveMenuFocus(workspaceItemsRef.current, -1);
            }
          }}
        >
          <div className="border-b border-[var(--line)] px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {t("sidebar.workspace")}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              {t("sidebar.workspaceHint")}
            </p>
          </div>
          <div className="grid max-h-[240px] gap-1 overflow-y-auto" ref={workspaceItemsRef} role="menu">
            {availableWorkspaces.map((workspace) => {
              const active = workspace.id === activeWorkspace.id;
              return (
                <button
                  aria-checked={active}
                  className={cn(
                    "flex items-start gap-3 rounded-md px-3 py-2 text-left transition",
                    active
                      ? "bg-[var(--panel-soft-strong)] text-[var(--ink)] ring-1 ring-[var(--line-strong)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--panel-soft)]"
                  )}
                  data-workspace-item
                  key={workspace.id}
                  onClick={() => {
                    setWorkspaceId(workspace.id);
                    setWorkspaceOpen(false);
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--brand)]/15 text-xs font-semibold text-[var(--brand)]">
                    {workspace.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">
                        {t(workspace.nameKey as MessageKey)}
                      </p>
                      {active ? (
                        <span className="rounded-full border border-[var(--line-strong)] bg-[var(--panel-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand)]">
                          {t("sidebar.workspaceCurrent")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--ink-soft)]">
                      {t(workspace.descriptionKey as MessageKey)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

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
      <nav className="grid gap-1" role="navigation" aria-label="Main navigation">
        {renderNavItem(navigation[0])}
        {renderNavItem(navigation[1])}
        {renderNavItem(navigation[2], totalTaskCount)}
      </nav>

      {/* Planning Section - Collapsible */}
      <div className="mt-2">
        <button
          aria-expanded={!collapsedSections.planning}
          aria-label="Планирование секция"
          className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--ink-soft)]"
          onClick={() => toggleSection("planning")}
          type="button"
        >
          <span>Планирование</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              !collapsedSections.planning && "rotate-90"
            )}
          />
        </button>
        {!collapsedSections.planning && (
          <div className="grid gap-1" role="group">
            {navigation.slice(3, 7).map((item) => renderNavItem(item, undefined, true))}
          </div>
        )}
      </div>

      {/* Team & Risks - Collapsible */}
      <div className="mt-2">
        <button
          aria-expanded={!collapsedSections.team}
          aria-label="Команда секция"
          className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--ink-soft)]"
          onClick={() => toggleSection("team")}
          type="button"
        >
          <span>Команда</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              !collapsedSections.team && "rotate-90"
            )}
          />
        </button>
        {!collapsedSections.team && (
          <div className="grid gap-1" role="group">
            {renderNavItem(navigation[7], undefined, true)}
            {renderNavItem(navigation[8], totalRiskCount, true)}
          </div>
        )}
      </div>

      {/* AI - Single item */}
      <div className="mt-2">
        {renderNavItem(navigation[9], undefined, true)}
      </div>

    {/* Executive Ops - Collapsible */}
      <div className="mt-2">
        <button
          aria-expanded={!collapsedSections.ops}
          aria-label="Executive Ops секция"
          className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--ink-soft)]"
          onClick={() => toggleSection("ops")}
          type="button"
        >
          <span>Executive Ops</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              !collapsedSections.ops && "rotate-90"
            )}
          />
        </button>
        {!collapsedSections.ops && (
          <div className="space-y-2" role="group">
            {operationsSections.map((section) => (
              <div key={section.id}>
                <button
                  aria-expanded={!collapsedSections[`ops-${section.id}`]}
                  aria-label={`${section.label} секция`}
                  className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)] hover:text-[var(--ink-soft)]"
                  onClick={() => toggleSection(`ops-${section.id}`)}
                  type="button"
                >
                  <span>{section.label}</span>
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform",
                      !collapsedSections[`ops-${section.id}`] && "rotate-90"
                    )}
                  />
                </button>
                {!collapsedSections[`ops-${section.id}`] && (
                  <div className="grid gap-0.5">
                    {section.items.map((item) => renderNavItem(item, undefined, true))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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

      {/* Portfolio Health - Collapsible */}
      <div className="mt-auto grid gap-3 pt-2">
        <div>
          <button
            aria-expanded={!collapsedSections.portfolio}
            aria-label="Portfolio Health секция"
            className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[linear-gradient(180deg,#16233f_0%,#213b74_100%)] p-4 text-white"
            onClick={() => toggleSection("portfolio")}
            type="button"
          >
            <div className="flex-1 text-left">
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">{t("dashboard.portfolioHealth")}</p>
              <p className="mt-3 text-4xl font-semibold tracking-[-0.08em]">{portfolioHealth}%</p>
            </div>
            <ChevronRight
              className={cn(
                "h-5 w-5 text-white/60 transition-transform",
                !collapsedSections.portfolio && "rotate-90"
              )}
            />
          </button>
          {!collapsedSections.portfolio && (
            <div className="mt-2 grid gap-2 text-sm">
              <Link
                className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:bg-[var(--panel-soft-strong)]"
                href="/projects"
                onClick={onNavigate}
              >
                <span className="text-[var(--ink-soft)]">{t("dashboard.activeProjectsLabel")}</span>
                <span className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                  {activeProjectCount}
                  <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
                </span>
              </Link>
              <Link
                className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:bg-[var(--panel-soft-strong)]"
                href="/risks"
                onClick={onNavigate}
              >
                <span className="text-[var(--ink-soft)]">{t("dashboard.atRiskProjectsLabel")}</span>
                <span className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                  {atRiskProjectCount}
                  <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
                </span>
              </Link>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="grid gap-1">
          {footerNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--panel-soft)] hover:text-[var(--ink)]",
                  active && "bg-[var(--panel-soft)] text-[var(--ink)]"
                )}
                href={item.href}
                key={item.href}
                onClick={onNavigate}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{getItemLabel(item)}</span>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
