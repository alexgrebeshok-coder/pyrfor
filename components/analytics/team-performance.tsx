"use client";

import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { leadingLabel } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
} from "recharts";
import { MemberCard } from "./member-card";
import type {
  TeamBarChartData,
  TeamRadarChartData,
} from "@/lib/types/team-performance";
import { useAnalyticsTeamPerformance } from "@/lib/hooks/use-analytics-team-performance";

interface TeamPerformanceProps {
  projectId?: string;
}

/**
 * Custom tooltip for bar chart with Russian formatting
 */
function CustomBarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-panel)] p-3 shadow-lg">
      <p className="mb-2 font-semibold text-[var(--ink)]">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="h-3 w-3 rounded"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[var(--ink-muted)]">{entry.name}:</span>
          <span className="font-medium text-[var(--ink)]">{entry.value}%</span>
        </div>
      ))}
    </div>
  );
}

export const TeamPerformance = React.memo(function TeamPerformance({
  projectId,
}: TeamPerformanceProps) {
  const { data, error, isLoading } = useAnalyticsTeamPerformance(projectId);
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const summary = data?.summary ?? null;

  const membersWithUtilization = useMemo(() => {
    return members.map((member) => ({
      ...member,
      utilization: member.metrics.completionRate,
      trend: "stable" as const,
    }));
  }, [members]);

  const avgUtilization = useMemo(() => {
    if (membersWithUtilization.length === 0) return 0;
    return Math.round(
      membersWithUtilization.reduce((sum, m) => sum + (m.utilization || 0), 0) /
        membersWithUtilization.length
    );
  }, [membersWithUtilization]);

  const avgCompletion = useMemo(() => {
    if (members.length === 0) return 0;
    return Math.round(
      members.reduce((sum, m) => sum + m.metrics.completionRate, 0) /
        members.length
    );
  }, [members]);

  const barChartData: TeamBarChartData[] = useMemo(() => {
    return membersWithUtilization.map((m) => ({
      name: m.memberInitials || leadingLabel(m.memberName),
      Утилизация: m.utilization || 0,
      Выполнение: m.metrics.completionRate,
    }));
  }, [membersWithUtilization]);

  const radarChartData: TeamRadarChartData[] = useMemo(() => {
    const avgTasks = members.length > 0
      ? Math.round(members.reduce((sum, m) => sum + m.metrics.totalTasks, 0) / members.length)
      : 0;

    return [
      { metric: "Утилизация", value: avgUtilization, fullMark: 100 },
      { metric: "Выполнение", value: avgCompletion, fullMark: 100 },
      { metric: "Активность", value: Math.min(100, avgTasks * 10), fullMark: 100 },
      { metric: "Рейтинг", value: summary?.avgPerformanceScore ?? 0, fullMark: 100 },
    ];
  }, [avgUtilization, avgCompletion, members, summary]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-4">
              <div className="h-16 animate-pulse rounded bg-[var(--surface-secondary)]" />
            </Card>
          ))}
        </div>
        <Card className="p-6">
          <div className="h-48 animate-pulse rounded bg-[var(--surface-secondary)]" />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 text-center">
        <div className="text-red-500 mb-2">⚠️ Ошибка</div>
        <p className="text-[var(--ink-muted)]">
          {error instanceof Error ? error.message : "Ошибка загрузки данных"}
        </p>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card className="p-6 text-center">
        <p className="text-[var(--ink-muted)]">Нет сведений по команде</p>
      </Card>
    );
  }

  if (members.length === 0) {
    return (
      <Card className="p-6 text-center">
        <div className="flex flex-col items-center justify-center h-[200px]">
          <p className="text-lg text-[var(--ink-muted)]">Нет данных о команде</p>
          <p className="text-sm text-[var(--ink-muted)] mt-2">
            Добавьте участников и задачи для отображения статистики
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with summary */}
      <div>
        <h2 className="text-xl font-semibold text-[var(--ink)]">Эффективность работы</h2>
        <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-muted)] mt-1">
          <span>Средняя утилизация: <strong className="text-[var(--ink)]">{avgUtilization}%</strong></span>
          <span>Выполнено: <strong className="text-[var(--ink)]">{avgCompletion}%</strong></span>
          <span>Участников: <strong className="text-[var(--ink)]">{summary.totalMembers}</strong></span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-sm text-[var(--ink-muted)]">Участников</div>
          <div className="mt-1 text-2xl font-bold text-[var(--ink)]">{summary.totalMembers}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[var(--ink-muted)]">Всего задач</div>
          <div className="mt-1 text-2xl font-bold text-[var(--ink)]">{summary.totalTasks}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[var(--ink-muted)]">Выполнено</div>
          <div className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{summary.totalCompleted}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-[var(--ink-muted)]">Средний рейтинг</div>
          <div className="mt-1 text-2xl font-bold text-[var(--ink)]">{summary.avgPerformanceScore}</div>
        </Card>
      </div>

      {/* Member Cards */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ink)] mb-3">Участники команды</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {membersWithUtilization.map((member) => (
            <MemberCard key={member.memberId} member={member} />
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart - Team Utilization */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4 text-[var(--ink)]">Утилизация команды</h3>
          <div
            role="img"
            aria-label="График утилизации команды: сравнение выполнения и утилизации по участникам"
          >
            <ResponsiveContainer width="100%" height={200} className="md:!h-[300px]">
              <BarChart data={barChartData} aria-hidden="true">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--line)' }}
              />
              <YAxis 
                domain={[0, 100]}
                tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--line)' }}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar 
                dataKey="Утилизация" 
                fill="#3b82f6" 
                radius={[4, 4, 0, 0]}
                name="Утилизация"
              />
              <Bar 
                dataKey="Выполнение" 
                fill="#10b981" 
                radius={[4, 4, 0, 0]}
                name="Выполнение"
              />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </Card>

        {/* Radar Chart - Multi-dimensional metrics */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4 text-[var(--ink)]">Эффективность (радар)</h3>
          <div
            role="img"
            aria-label="Радарная диаграмма эффективности команды: утилизация, выполнение, активность, рейтинг"
          >
            <ResponsiveContainer width="100%" height={200} className="md:!h-[300px]">
              <RadarChart data={radarChartData} aria-hidden="true">
              <PolarGrid stroke="var(--line)" />
              <PolarAngleAxis 
                dataKey="metric" 
                tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
              />
              <PolarRadiusAxis 
                angle={90} 
                domain={[0, 100]}
                tick={{ fill: 'var(--ink-muted)', fontSize: 10 }}
              />
              <Radar
                name="Команда"
                dataKey="value"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.5}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '10px' }}
                formatter={(value) => (
                  <span style={{ color: 'var(--ink-muted)' }}>{value}</span>
                )}
              />
            </RadarChart>
          </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
});
