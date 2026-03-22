"use client";

import { useLocale } from "@/contexts/locale-context";
import { useDashboard } from "@/components/dashboard-provider";

export function StatusBar() {
  const { locale, t } = useLocale();
  const { notifications, projects, tasks } = useDashboard();
  const inProgressCount = tasks.filter((task) => task.status === "in-progress").length;
  const timestamp = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return (
    <footer className="hidden shrink-0 border-t border-[var(--line-strong)] bg-[var(--statusbar-surface)] px-3 py-2 text-[10px] text-[var(--statusbar-ink)] sm:flex sm:h-7 sm:items-center sm:justify-between sm:px-4 sm:py-0 sm:text-xs">
      <div className="flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap pr-1 sm:gap-4 sm:overflow-visible">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          {t("shell.online")}
        </span>
        <span>
          {projects.length} {t("nav.projects").toLowerCase()}
        </span>
        <span>
          {tasks.length} {t("tasks.total").toLowerCase()}
        </span>
        <span>
          {inProgressCount} {t("tasks.inProgress").toLowerCase()}
        </span>
        <span>
          {notifications.length} {t("topbar.criticalFeed").toLowerCase()}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 whitespace-nowrap sm:mt-0 sm:justify-end sm:gap-4">
        <span>
          {t("shell.lastSync")}: {timestamp}
        </span>
        <span>v1.0.0</span>
      </div>
    </footer>
  );
}
