"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Project, UserProfile } from "@/types/map";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  projects: Project[];
  onProjectSelect: (project: Project) => void;
  user: UserProfile;
}

export function Sidebar({
  collapsed,
  onToggle,
  projects,
  onProjectSelect,
  user,
}: SidebarProps) {
  const [activeFilter, setActiveFilter] = useState<"all" | "warning" | "ok">("all");

  const filteredProjects = projects.filter((project) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "warning") return project.status === "warning" || project.status === "critical";
    if (activeFilter === "ok") return project.status === "ok";
    return true;
  });

  const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
  const totalRisks = projects.reduce((sum, p) => sum + (p.risks || 0), 0);
  const avgProgress = Math.round(
    projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length
  );

  return (
    <div
      className={`h-full bg-slate-900/95 backdrop-blur-md border-r border-slate-700/50 transition-all duration-300 ${
        collapsed ? "w-0" : "w-72"
      }`}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">CEOClaw</h2>
            <p className="text-xs text-slate-400">Command Center</p>
          </div>
          <button
            onClick={onToggle}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Свернуть панель"
          >
            ✕
          </button>
        </div>

        {/* Stats Summary */}
        <div className="grid gap-2 border-b border-slate-700/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Прогресс</span>
            <Badge variant={avgProgress >= 70 ? "success" : "warning"}>{avgProgress}%</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Бюджет</span>
            <Badge variant="neutral">₽{(totalBudget / 1000000).toFixed(1)}M</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Риски</span>
            <Badge variant={totalRisks > 0 ? "danger" : "success"}>{totalRisks}</Badge>
          </div>
        </div>

        {/* Filters */}
        <div className="border-b border-slate-700/50 p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Фильтры</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={activeFilter === "all" ? "default" : "outline"}
              onClick={() => setActiveFilter("all")}
            >
              Все
            </Button>
            <Button
              size="sm"
              variant={activeFilter === "warning" ? "default" : "outline"}
              onClick={() => setActiveFilter("warning")}
            >
              ⚠️ Проблемы
            </Button>
            <Button
              size="sm"
              variant={activeFilter === "ok" ? "default" : "outline"}
              onClick={() => setActiveFilter("ok")}
            >
              ✅ ОК
            </Button>
          </div>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Проекты ({filteredProjects.length})</div>
          <div className="grid gap-3">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => onProjectSelect(project)}
                className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 text-left hover:bg-slate-800/80 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-white truncate">{project.name}</div>
                    <div className="text-xs text-slate-400 truncate">{project.location}</div>
                  </div>
                  <Badge variant={getStatusVariant(project.status)}>
                    {project.progress}%
                  </Badge>
                </div>
                {project.risks > 0 && (
                  <div className="mt-2 text-xs text-amber-500">
                    ⚠️ {project.risks} {project.risks === 1 ? "риск" : "риска"}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* User Profile */}
        <div className="border-t border-slate-700/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
              {user.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-white truncate">{user.name}</div>
              <div className="text-xs text-slate-400">Level {user.level}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-blue-400">{user.xp} XP</div>
              <div className="text-xs text-slate-400">{user.achievements} 🏅</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStatusVariant(status: Project["status"]): "success" | "warning" | "danger" {
  switch (status) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    case "ok":
    default:
      return "success";
  }
}
