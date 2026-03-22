"use client";

import React from "react";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useTimelineData } from "@/lib/hooks/use-timeline-data";
import { STATUS_COLORS, STATUS_LABELS, type ProjectTimeline } from "@/lib/types/timeline";
import type { Task } from "gantt-task-react";

interface ProjectTimelineProps {
  className?: string;
}

/**
 * Transform project data to Gantt task format
 */
function transformToTasks(projects: ProjectTimeline[]): Task[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    start: project.startDate,
    end: project.endDate,
    progress: project.progress,
    type: "task" as const,
    styles: {
      backgroundColor: STATUS_COLORS[project.status],
      progressColor: STATUS_COLORS[project.status],
    },
  }));
}

/**
 * Loading skeleton component
 */
function TimelineLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-[var(--surface)] rounded w-1/4"></div>
      <div className="h-[400px] bg-[var(--surface)] rounded"></div>
    </div>
  );
}

/**
 * Error display component
 */
function TimelineError({ message }: { message?: string }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
      <p className="text-red-800 dark:text-red-200 text-sm">
        ⚠️ Ошибка загрузки данных таймлайна. Попробуйте обновить страницу.
      </p>
      {message && (
        <p className="text-red-600 dark:text-red-300 text-xs mt-1">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Empty state component
 */
function TimelineEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-[400px] bg-[var(--surface)] rounded-lg border border-[var(--border)]">
      <p className="text-[var(--ink-muted)] text-lg">
        Нет проектов для отображения
      </p>
      <p className="text-[var(--ink-muted)] text-sm mt-2">
        Добавьте проекты с датами начала и окончания
      </p>
    </div>
  );
}

/**
 * Legend component
 */
function TimelineLegend() {
  const statuses: Array<ProjectTimeline['status']> = ['planning', 'active', 'completed', 'delayed'];
  
  return (
    <div className="flex flex-wrap gap-4 mb-4">
      {statuses.map((status) => (
        <div key={status} className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded"
            style={{ backgroundColor: STATUS_COLORS[status] }}
          />
          <span className="text-sm text-[var(--ink)]">
            {STATUS_LABELS[status]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Project Timeline Chart Component
 * Displays projects as a Gantt chart with progress and status visualization
 */
export function ProjectTimeline({ className }: ProjectTimelineProps) {
  const { data, isLoading, error } = useTimelineData();

  if (isLoading) {
    return <TimelineLoading />;
  }

  if (error) {
    return <TimelineError message={error.message} />;
  }

  if (!data || data.length === 0) {
    return <TimelineEmpty />;
  }

  const tasks = transformToTasks(data);

  return (
    <div className={className}>
      <TimelineLegend />
      
      <div
        role="img"
        aria-label="График таймлайна проектов"
        aria-describedby="timeline-description"
        className="bg-white dark:bg-gray-900 rounded-lg border border-[var(--border)] overflow-hidden"
      >
        <span id="timeline-description" className="sr-only">
          Визуализация {data.length} проектов с датами начала, окончания и прогрессом.
          Используйте Tab для навигации между проектами.
        </span>
        
        <Gantt
          tasks={tasks}
          viewMode={ViewMode.Month}
          locale="ru-RU"
          todayColor="#FBBF24"
          listCellWidth="200px"
          columnWidth={60}
          headerHeight={50}
          rowHeight={40}
          barCornerRadius={4}
          barFill={60}
          TooltipContent={({ task }) => (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 shadow-lg">
              <p className="font-semibold text-[var(--ink)]">{task.name}</p>
              <p className="text-sm text-[var(--ink-muted)] mt-1">
                Начало: {new Date(task.start).toLocaleDateString('ru-RU')}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                Окончание: {new Date(task.end).toLocaleDateString('ru-RU')}
              </p>
              <p className="text-sm text-[var(--ink-muted)]">
                Прогресс: {task.progress}%
              </p>
            </div>
          )}
        />
      </div>
    </div>
  );
}
