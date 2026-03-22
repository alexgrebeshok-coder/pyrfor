"use client";

import React, { memo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TeamMemberPerformance } from "@/lib/types/team-performance";
import { cn } from "@/lib/utils";

interface MemberCardProps {
  member: TeamMemberPerformance;
}

/**
 * Get color class based on performance score
 * excellent: >=80% (green)
 * good: 60-80% (blue)
 * average: 40-60% (yellow)
 * poor: <40% (red)
 */
function getColorByPerformance(score: number): {
  bg: string;
  text: string;
  progress: string;
} {
  if (score >= 80) {
    return {
      bg: "bg-green-500",
      text: "text-green-600 dark:text-green-400",
      progress: "bg-green-500",
    };
  }
  if (score >= 60) {
    return {
      bg: "bg-blue-500",
      text: "text-blue-600 dark:text-blue-400",
      progress: "bg-blue-500",
    };
  }
  if (score >= 40) {
    return {
      bg: "bg-yellow-500",
      text: "text-yellow-600 dark:text-yellow-400",
      progress: "bg-yellow-500",
    };
  }
  return {
    bg: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    progress: "bg-red-500",
  };
}

/**
 * Get role label in Russian
 */
function getRoleLabel(role?: string | null): string {
  if (!role) return "Участник команды";
  
  const roleMap: Record<string, string> = {
    developer: "Разработчик",
    designer: "Дизайнер",
    manager: "Менеджер",
    analyst: "Аналитик",
    lead: "Тимлид",
    pm: "Проектный менеджер",
    qa: "Тестировщик",
    devops: "DevOps",
  };
  
  return roleMap[role.toLowerCase()] || role;
}

/**
 * Get trend indicator
 */
function getTrendIndicator(trend?: 'up' | 'down' | 'stable'): {
  icon: string;
  color: string;
  label: string;
} {
  switch (trend) {
    case 'up':
      return { icon: '↑', color: 'text-green-500', label: 'рост' };
    case 'down':
      return { icon: '↓', color: 'text-red-500', label: 'падение' };
    case 'stable':
      return { icon: '→', color: 'text-gray-500', label: 'стабильно' };
    default:
      return { icon: '→', color: 'text-gray-400', label: 'нет данных' };
  }
}

export const MemberCard = memo(function MemberCard({ member }: MemberCardProps) {
  const colors = getColorByPerformance(member.performanceScore);
  const trendInfo = getTrendIndicator(member.trend);
  const utilization = member.utilization ?? member.metrics.completionRate;
  
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      {/* Header: Name, Role, Trend */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white",
              colors.bg
            )}
            aria-label={`Аватар ${member.memberName}`}
          >
            {member.memberInitials || member.memberName.slice(0, 2).toUpperCase()}
          </div>
          
          <div>
            <h3 className="font-semibold text-[var(--ink)] leading-tight">
              {member.memberName}
            </h3>
            <p className="text-sm text-[var(--ink-muted)]">
              {getRoleLabel(member.role)}
            </p>
          </div>
        </div>
        
        {/* Trend indicator */}
        <span
          className={cn("text-lg", trendInfo.color)}
          aria-label={`Тренд: ${trendInfo.label}`}
          title={trendInfo.label}
        >
          {trendInfo.icon}
        </span>
      </div>
      
      {/* Utilization Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-[var(--ink-muted)]">Утилизация</span>
          <span className="font-medium text-[var(--ink)]">{utilization}%</span>
        </div>
        <div
          className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden"
          role="progressbar"
          aria-valuenow={utilization}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Утилизация ${utilization}%`}
        >
          <div
            className={cn("h-2 rounded-full transition-all duration-500", colors.progress)}
            style={{ width: `${utilization}%` }}
          />
        </div>
      </div>
      
      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[var(--ink-muted)] text-xs">Задачи</p>
          <p className="font-medium text-[var(--ink)]">
            <span className={colors.text}>{member.metrics.completedTasks}</span>
            <span className="text-[var(--ink-muted)]">/{member.metrics.totalTasks}</span>
          </p>
        </div>
        
        <div>
          <p className="text-[var(--ink-muted)] text-xs">Часы</p>
          <p className="font-medium text-[var(--ink)]">
            {member.time.totalHoursLogged}ч
          </p>
        </div>
      </div>
      
      {/* Performance Score Badge */}
      <div className="mt-3 flex justify-end">
        <Badge
          variant={
            member.performanceScore >= 70
              ? "success"
              : member.performanceScore >= 40
              ? "warning"
              : "danger"
          }
          className="text-xs"
        >
          Рейтинг: {member.performanceScore}
        </Badge>
      </div>
    </Card>
  );
});
