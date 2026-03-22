"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  Search,
  ShieldAlert,
  Users2,
  CheckSquare2,
} from "lucide-react";

import { useDashboard } from "@/components/dashboard-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/locale-context";

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projects, tasks, risks, documents, milestones, team } = useDashboard();
  const { locale, t } = useLocale();
  const query = searchParams.get("q")?.trim() ?? "";
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  const normalizedQuery = query.toLowerCase();
  const hasQuery = normalizedQuery.length > 0;

  const projectResults = useMemo(
    () =>
      hasQuery
        ? projects.filter((project) =>
            [
              project.name,
              project.description,
              project.location,
              project.direction,
              project.team.join(" "),
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
        : projects,
    [hasQuery, normalizedQuery, projects]
  );

  const taskResults = useMemo(
    () =>
      hasQuery
        ? tasks.filter((task) =>
            [
              task.title,
              task.description,
              task.assignee?.name,
              task.priority,
              task.status,
              projectResults.find((project) => project.id === task.projectId)?.name,
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
        : tasks,
    [hasQuery, normalizedQuery, projectResults, tasks]
  );

  const riskResults = useMemo(
    () =>
      hasQuery
        ? risks.filter((risk) =>
            [risk.title, risk.description, risk.owner, risk.category]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
        : risks,
    [hasQuery, normalizedQuery, risks]
  );

  const documentResults = useMemo(
    () =>
      hasQuery
        ? documents.filter((document) =>
            [document.title, document.owner, document.type, document.size]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
        : documents,
    [hasQuery, documents, normalizedQuery]
  );

  const milestoneResults = useMemo(
    () =>
      hasQuery
        ? milestones.filter((milestone) =>
            [milestone.name, milestone.status, milestone.projectId]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
        : milestones,
    [hasQuery, milestones, normalizedQuery]
  );

  const teamResults = useMemo(
    () =>
      hasQuery
        ? team.filter((member) =>
            [member.name, member.role, member.email]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          )
        : team,
    [hasQuery, normalizedQuery, team]
  );

  const totalResults =
    projectResults.length +
    taskResults.length +
    riskResults.length +
    documentResults.length +
    milestoneResults.length +
    teamResults.length;

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.replace(draft.trim() ? `/search?q=${encodeURIComponent(draft.trim())}` : "/search");
  };

  const heading =
    locale === "ru" ? "Поиск по рабочему пространству" : locale === "zh" ? "工作区搜索" : "Workspace search";
  const subheading =
    locale === "ru"
      ? "Ищите проекты, задачи, риски, документы, этапы и людей в одном месте."
      : locale === "zh"
        ? "在一个地方搜索项目、任务、风险、文档、里程碑和成员。"
        : "Search projects, tasks, risks, documents, milestones, and team in one place.";

  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              {heading}
            </span>
            <p className="text-sm text-[var(--ink-soft)]">{subheading}</p>
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submitSearch}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <Input
                aria-label={heading}
                className="pl-10"
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("topbar.searchPlaceholder")}
                value={draft}
              />
            </div>
            <Button type="submit">{locale === "ru" ? "Искать" : locale === "zh" ? "搜索" : "Search"}</Button>
          </form>
          <div className="text-xs text-[var(--ink-soft)]">
            {hasQuery
              ? locale === "ru"
                ? `Найдено ${totalResults} результатов`
                : locale === "zh"
                  ? `找到 ${totalResults} 个结果`
                  : `Found ${totalResults} results`
              : locale === "ru"
                ? "Введите запрос, чтобы увидеть результаты."
                : locale === "zh"
                  ? "输入搜索词以查看结果。"
                  : "Enter a query to see results."}
          </div>
        </div>
      </Card>

      {hasQuery && totalResults === 0 ? (
        <Card className="border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60 p-6">
          <div className="grid gap-2 text-center">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              {locale === "ru" ? "Ничего не найдено" : locale === "zh" ? "没有匹配结果" : "Nothing matched"}
            </h2>
            <p className="mx-auto max-w-xl text-sm text-[var(--ink-soft)]">
              {locale === "ru"
                ? "Попробуйте другой запрос или откройте Projects/Tasks и отфильтруйте данные там."
                : locale === "zh"
                  ? "尝试其他搜索词，或在项目/任务页面中继续筛选。"
                  : "Try a different query or continue filtering in Projects and Tasks."}
            </p>
          </div>
        </Card>
      ) : null}

      {projectResults.length > 0 ? (
        <SearchSection
          icon={<FolderKanban className="h-4 w-4" />}
          title={t("nav.projects")}
          count={projectResults.length}
        >
          {projectResults.slice(0, 6).map((project) => (
            <Link
              key={project.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
              href={`/projects/${project.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--ink)]">{project.name}</p>
                <p className="truncate text-xs text-[var(--ink-soft)]">
                  {project.direction} · {project.status} · {project.progress}%
                </p>
              </div>
              <Badge variant={project.status === "at-risk" ? "danger" : "neutral"}>
                {project.health}%
              </Badge>
            </Link>
          ))}
        </SearchSection>
      ) : null}

      {taskResults.length > 0 ? (
        <SearchSection
          icon={<CheckSquare2 className="h-4 w-4" />}
          title={t("nav.tasks")}
          count={taskResults.length}
        >
          {taskResults.slice(0, 6).map((task) => {
            const project = projects.find((item) => item.id === task.projectId);
            return (
              <Link
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
                href={`/tasks?query=${encodeURIComponent(task.title)}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{task.title}</p>
                  <p className="truncate text-xs text-[var(--ink-soft)]">
                    {project?.name ?? task.projectId} · {task.assignee?.name ?? "Unassigned"}
                  </p>
                </div>
                <Badge
                  variant={
                    task.status === "done"
                      ? "success"
                      : task.status === "blocked"
                        ? "danger"
                        : task.status === "in-progress"
                          ? "info"
                          : "neutral"
                  }
                >
                  {task.status}
                </Badge>
              </Link>
            );
          })}
        </SearchSection>
      ) : null}

      {riskResults.length > 0 ? (
        <SearchSection
          icon={<ShieldAlert className="h-4 w-4" />}
          title={t("nav.risks")}
          count={riskResults.length}
        >
          {riskResults.slice(0, 6).map((risk) => {
            const project = projects.find((item) => item.id === risk.projectId);
            return (
              <Link
                key={risk.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
                href="/risks"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{risk.title}</p>
                  <p className="truncate text-xs text-[var(--ink-soft)]">
                    {project?.name ?? risk.projectId} · {risk.owner}
                  </p>
                </div>
                <Badge variant={risk.status === "closed" ? "success" : "danger"}>{risk.status}</Badge>
              </Link>
            );
          })}
        </SearchSection>
      ) : null}

      {milestoneResults.length > 0 ? (
        <SearchSection
          icon={<CalendarDays className="h-4 w-4" />}
          title={t("nav.calendar")}
          count={milestoneResults.length}
        >
          {milestoneResults.slice(0, 6).map((milestone) => {
            const project = projects.find((item) => item.id === milestone.projectId);
            return (
              <Link
                key={milestone.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
                href="/calendar"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{milestone.name}</p>
                  <p className="truncate text-xs text-[var(--ink-soft)]">
                    {project?.name ?? milestone.projectId} · {milestone.progress}%
                  </p>
                </div>
                <Badge variant={milestone.status === "completed" ? "success" : "neutral"}>
                  {milestone.status}
                </Badge>
              </Link>
            );
          })}
        </SearchSection>
      ) : null}

      {documentResults.length > 0 ? (
        <SearchSection
          icon={<FileText className="h-4 w-4" />}
          title={locale === "ru" ? "Документы" : locale === "zh" ? "文档" : "Documents"}
          count={documentResults.length}
        >
          {documentResults.slice(0, 6).map((document) => {
            const project = projects.find((item) => item.id === document.projectId);
            return (
              <Link
                key={document.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
                href={`/documents?q=${encodeURIComponent(document.title)}&folder=project`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{document.title}</p>
                  <p className="truncate text-xs text-[var(--ink-soft)]">
                    {project?.name ?? document.projectId} · {document.type}
                  </p>
                </div>
                <Badge variant="neutral">{document.size}</Badge>
              </Link>
            );
          })}
        </SearchSection>
      ) : null}

      {teamResults.length > 0 ? (
        <SearchSection
          icon={<Users2 className="h-4 w-4" />}
          title={locale === "ru" ? "Команда" : locale === "zh" ? "团队" : "Team"}
          count={teamResults.length}
        >
          {teamResults.slice(0, 6).map((member) => (
            <Link
              key={member.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
              href="/team"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--ink)]">{member.name}</p>
                <p className="truncate text-xs text-[var(--ink-soft)]">
                  {member.role} · {member.email || "no email"}
                </p>
              </div>
              <Badge variant="neutral">{member.capacity}%</Badge>
            </Link>
          ))}
        </SearchSection>
      ) : null}
    </div>
  );
}

function SearchSection({
  children,
  count,
  icon,
  title,
}: {
  children: ReactNode;
  count: number;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Card className="p-4">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--panel-soft)] text-[var(--brand)]">
              {icon}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
              <p className="text-xs text-[var(--ink-soft)]">{count}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-2">{children}</div>
      </div>
    </Card>
  );
}
