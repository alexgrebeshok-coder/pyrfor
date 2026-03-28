"use client";

import type { Project, UserProfile } from "@/types/map";

interface StatusBarProps {
  projects: Project[];
  user: UserProfile;
}

export function StatusBar({ projects, user }: StatusBarProps) {
  const totalBudget = projects.reduce((sum, p) => sum + p.budget, 0);
  const totalRisks = projects.reduce((sum, p) => sum + p.risks, 0);
  const avgProgress = Math.round(
    projects.reduce((sum, p) => sum + p.progress, 0) / projects.length
  );

  const formatBudget = (budget: number): string => {
    if (budget >= 1000000) {
      return `${(budget / 1000000).toFixed(1)}M`;
    }
    return `${(budget / 1000).toFixed(0)}K`;
  };

  const now = new Date();
  const timeString = now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-center justify-between bg-slate-900/95 backdrop-blur-md border-t border-slate-700/50 px-4 py-2 text-sm">
      {/* Left: Resources */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-slate-300">
          <span className="text-base">💰</span>
          <span className="font-semibold text-white">{formatBudget(totalBudget)}</span>
        </div>

        <div className="flex items-center gap-2 text-slate-300">
          <span className="text-base">👥</span>
          <span className="font-semibold text-white">{projects.length}</span>
        </div>

        <div className="flex items-center gap-2 text-slate-300">
          <span className="text-base">📦</span>
          <span className="font-semibold text-white">{avgProgress}%</span>
        </div>

        <div className="flex items-center gap-2 text-slate-300">
          <span className="text-base">⚠️</span>
          <span className="font-semibold text-amber-400">{totalRisks}</span>
        </div>
      </div>

      {/* Center: Progress bars */}
      <div className="flex items-center gap-3">
        {projects.slice(0, 3).map((project) => (
          <div key={project.id} className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{project.name}</span>
            <div className="h-2 w-16 rounded-full bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  project.status === "warning"
                    ? "bg-amber-500"
                    : project.status === "critical"
                    ? "bg-red-500"
                    : "bg-green-500"
                }`}
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Right: Time + User */}
      <div className="flex items-center gap-4">
        <div className="text-slate-300">
          <span className="text-base">🕐</span>
          <span className="font-mono text-xs">{timeString}</span>
        </div>

        <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
          <span className="text-base">🏆</span>
          <span className="text-xs text-slate-400">L{user.level}</span>
          <span className="text-sm font-semibold text-blue-400">{user.xp} XP</span>
        </div>
      </div>
    </div>
  );
}
