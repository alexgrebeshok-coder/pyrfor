"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useDashboardSnapshot } from "./use-api";
import { generateInsights, type AIInsight } from "@/lib/ai/insights-generator";
import type { Project, Task, TeamMember, Risk, EVMMetrics, AutoRisk, Severity } from "@/lib/types";

/**
 * Calculate EVM metrics for a project (non-hook version)
 */
function calculateEVMMetrics(project: Project): EVMMetrics | null {
  const { budget, progress, dates } = project;
  const plannedBudget = budget.planned;
  const actualCost = budget.actual;

  // Earned Value: запланированный бюджет × прогресс
  const ev = plannedBudget * (progress / 100);

  // Planned Value: запланированный бюджет × (прошедшее время / общая длительность)
  const startDate = new Date(dates.start);
  const endDate = new Date(dates.end);
  const now = new Date();

  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const scheduleProgress = Math.max(0, Math.min(1, elapsed / totalDuration));
  const pv = plannedBudget * scheduleProgress;

  // Actual Cost: фактические затраты
  const ac = actualCost;

  // CPI (Cost Performance Index): EV / AC
  const cpi = ac > 0 ? ev / ac : ev > 0 ? 1 : 0;

  // SPI (Schedule Performance Index): EV / PV
  const spi = pv > 0 ? ev / pv : ev > 0 ? 1 : 0;

  // EAC (Estimate at Completion): BAC / CPI
  const eac = cpi > 0 ? plannedBudget / cpi : plannedBudget;

  // VAC (Variance at Completion): BAC - EAC
  const vac = plannedBudget - eac;

  return {
    ev: Math.round(ev),
    pv: Math.round(pv),
    ac: Math.round(ac),
    cpi: Math.round(cpi * 100) / 100,
    spi: Math.round(spi * 100) / 100,
    eac: Math.round(eac),
    vac: Math.round(vac),
    percentComplete: progress,
  };
}

/**
 * Calculate auto-detected risks for a project (non-hook version)
 */
function calculateAutoRisks(
  project: Project,
  tasks: Task[],
  team: TeamMember[],
  existingRisks: Risk[],
  evmMetrics: EVMMetrics | null
): AutoRisk[] {
  if (!evmMetrics) return [];

  const risks: AutoRisk[] = [];
  const now = new Date();

  // 1. Schedule risks (SPI-based)
  if (evmMetrics.spi < 0.9) {
    const severity: Severity = evmMetrics.spi < 0.7 ? "critical" : "warning";
    risks.push({
      id: `auto-schedule-${project.id}`,
      projectId: project.id,
      type: "schedule",
      severity,
      title:
        severity === "critical"
          ? "Критическое отставание от графика"
          : "Отставание от графика",
      description: `SPI = ${evmMetrics.spi.toFixed(
        2
      )}. Проект выполняется медленнее плана на ${Math.round(
        (1 - evmMetrics.spi) * 100
      )}%.`,
      detectedAt: now.toISOString(),
      probability: evmMetrics.spi < 0.7 ? 90 : 70,
      impact: evmMetrics.spi < 0.7 ? 90 : 60,
      recommendation:
        "Проверить критический путь, увеличить ресурсы или пересмотреть сроки.",
    });
  }

  // 2. Check for overdue milestones
  const projectEndDate = new Date(project.dates.end);
  if (projectEndDate < now && project.progress < 100) {
    risks.push({
      id: `auto-overdue-${project.id}`,
      projectId: project.id,
      type: "schedule",
      severity: "critical",
      title: "Просрочен дедлайн проекта",
      description: `Дата завершения ${project.dates.end} прошла, прогресс ${project.progress}%.`,
      detectedAt: now.toISOString(),
      probability: 100,
      impact: 90,
      recommendation:
        "Немедленно пересмотреть план и уведомить стейкхолдеров.",
    });
  }

  // 3. Budget risks (CPI-based)
  if (evmMetrics.cpi < 0.9) {
    const severity: Severity = evmMetrics.cpi < 0.7 ? "critical" : "warning";
    const budgetVariance = project.budget.planned > 0 
      ? ((evmMetrics.eac - project.budget.planned) / project.budget.planned) * 100 
      : 0;
    risks.push({
      id: `auto-budget-${project.id}`,
      projectId: project.id,
      type: "budget",
      severity,
      title:
        severity === "critical"
          ? "Критическое превышение бюджета"
          : "Риск превышения бюджета",
      description: `CPI = ${evmMetrics.cpi.toFixed(
        2
      )}. Прогнозируемое превышение: ${Math.abs(budgetVariance).toFixed(1)}%.`,
      detectedAt: now.toISOString(),
      probability: evmMetrics.cpi < 0.7 ? 90 : 70,
      impact: evmMetrics.cpi < 0.7 ? 90 : 60,
      recommendation:
        "Проанализировать затраты, найти способы экономии или запросить дополнительный бюджет.",
    });
  }

  // 4. Resource risks (overloaded team)
  const overloadedMembers = team.filter(
    (member) => member.capacity > 0 && member.allocated / member.capacity > 0.9
  );
  if (overloadedMembers.length > 0) {
    risks.push({
      id: `auto-resource-${project.id}`,
      projectId: project.id,
      type: "resource",
      severity: "warning",
      title: "Перегрузка команды",
      description: `${overloadedMembers.length} из ${team.length} участников загружены более 90%.`,
      detectedAt: now.toISOString(),
      probability: 80,
      impact: 50,
      recommendation:
        "Перераспределить задачи или привлечь дополнительных исполнителей.",
    });
  }

  // 5. Resource risks (understaffed)
  if (team.length < 2 && project.progress < 100) {
    risks.push({
      id: `auto-understaffed-${project.id}`,
      projectId: project.id,
      type: "resource",
      severity: "warning",
      title: "Недостаточно ресурсов",
      description: `В команде только ${team.length} человек.`,
      detectedAt: now.toISOString(),
      probability: 60,
      impact: 70,
      recommendation: "Рассмотреть возможность расширения команды.",
    });
  }

  // 6. Scope risks (blocked tasks)
  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  if (blockedTasks.length > 2) {
    risks.push({
      id: `auto-blocked-${project.id}`,
      projectId: project.id,
      type: "scope",
      severity: blockedTasks.length > 5 ? "critical" : "warning",
      title: "Много заблокированных задач",
      description: `${blockedTasks.length} задач заблокировано и требует внимания.`,
      detectedAt: now.toISOString(),
      probability: 80,
      impact: blockedTasks.length > 5 ? 80 : 50,
      recommendation:
        "Провести ревью заблокированных задач, устранить препятствия.",
    });
  }

  // 7. High existing risks
  const highRisks = existingRisks.filter(
    (r) => r.status === "open" && r.probability >= 4 && r.impact >= 4
  );
  if (highRisks.length > 2) {
    risks.push({
      id: `auto-highrisks-${project.id}`,
      projectId: project.id,
      type: "scope",
      severity: "critical",
      title: "Высокие риски без митигации",
      description: `${highRisks.length} рисков с высокой вероятностью и импактом.`,
      detectedAt: now.toISOString(),
      probability: 70,
      impact: 90,
      recommendation:
        "Немедленно разработать планы митигации для критических рисков.",
    });
  }

  return risks;
}

/**
 * AI Insights Hook
 * Generates and caches AI-powered insights for the portfolio
 */
export function useAIInsights(
  cacheDuration: number = 5 * 60 * 1000 // 5 minutes default
) {
  const { projects, tasks, team, risks } = useDashboardSnapshot();
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [lastGenerated, setLastGenerated] = useState<number>(0);
  const generatingRef = useRef(false);

  // Generate insights when data changes
  useEffect(() => {
    // Skip if no projects
    if (projects.length === 0) {
      return;
    }

    // Check cache validity
    const now = Date.now();
    if (insights.length > 0 && now - lastGenerated < cacheDuration) {
      return;
    }

    // Prevent concurrent generation
    if (generatingRef.current) {
      return;
    }

    generatingRef.current = true;

    // Calculate EVM metrics for all projects
    const evmMetricsMap = new Map<string, EVMMetrics>();
    projects.forEach((project) => {
      const metrics = calculateEVMMetrics(project);
      if (metrics) {
        evmMetricsMap.set(project.id, metrics);
      }
    });

    // Calculate auto-risks for all projects
    const autoRisksMap = new Map<string, AutoRisk[]>();
    projects.forEach((project) => {
      const projectTasks = tasks.filter((t) => t.projectId === project.id);
      const projectTeam = team.filter((m) => m.projects.includes(project.name));
      const projectRisks = risks.filter((r) => r.projectId === project.id);
      const evmMetrics = evmMetricsMap.get(project.id) || null;

      const autoRisks = calculateAutoRisks(
        project,
        projectTasks,
        projectTeam,
        projectRisks,
        evmMetrics
      );

      if (autoRisks.length > 0) {
        autoRisksMap.set(project.id, autoRisks);
      }
    });

    // Generate insights with real EVM and risks data
    const newInsights = generateInsights(projects, evmMetricsMap, autoRisksMap);

    setInsights(newInsights);
    setLastGenerated(now);
    generatingRef.current = false;
  }, [projects, tasks, team, risks, cacheDuration, insights.length, lastGenerated]);

  // Manual cache invalidation
  const invalidateCache = useCallback(() => {
    setInsights([]);
    setLastGenerated(0);
  }, []);

  return {
    insights,
    isLoading: false,
    error: null,
    invalidateCache,
  };
}
