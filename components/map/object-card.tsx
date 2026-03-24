"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types/map";

interface ObjectCardProps {
  project: Project;
  onClose: () => void;
}

export function ObjectCard({ project, onClose }: ObjectCardProps) {
  const [expanded, setExpanded] = useState(false);

  const formatBudget = (budget: number): string => {
    if (budget >= 1000000) {
      return `${(budget / 1000000).toFixed(1)}M ₽`;
    }
    return `${(budget / 1000).toFixed(0)}K ₽`;
  };

  const getStatusColor = (status: Project["status"]): string => {
    switch (status) {
      case "critical":
        return "text-red-500";
      case "warning":
        return "text-amber-500";
      case "ok":
      default:
        return "text-green-500";
    }
  };

  return (
    <div className="absolute right-4 top-4 z-30 w-80 rounded-2xl border border-slate-700/50 bg-slate-900/95 backdrop-blur-md p-4 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-700/50 pb-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{project.name}</h3>
          <p className="text-sm text-slate-400">{project.location}</p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-400">Прогресс</div>
          <div className={`mt-1 text-2xl font-bold ${getStatusColor(project.status)}`}>
            {project.progress}%
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-400">Бюджет</div>
          <div className="mt-1 text-lg font-semibold text-white">
            {formatBudget(project.budget)}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-400">Риски</div>
          <div className={`mt-1 text-lg font-bold ${project.risks > 0 ? "text-amber-400" : "text-green-400"}`}>
            {project.risks}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-400">Статус</div>
          <div className="mt-1">
            <Badge variant={project.status === "ok" ? "success" : "warning"}>
              {project.status === "ok" ? "Норма" : "Внимание"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-sm text-slate-300">{project.description}</p>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="outline">
          📞 Позвонить
        </Button>
        <Button size="sm" variant="outline">
          ✉️ Написать
        </Button>
        <Button size="sm">
          📊 Подробнее
        </Button>
      </div>

      {/* Expand button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-300 transition-colors"
      >
        {expanded ? "▲ Свернуть" : "▼ Развернуть"}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 border-t border-slate-700/50 pt-3">
          <h4 className="text-sm font-semibold text-white">История</h4>
          <div className="mt-2 space-y-2 text-sm text-slate-300">
            <p>• Создан: 15.03.2026</p>
            <p>• Последнее обновление: сегодня</p>
            <p>• Участников: 8</p>
          </div>
        </div>
      )}
    </div>
  );
}
