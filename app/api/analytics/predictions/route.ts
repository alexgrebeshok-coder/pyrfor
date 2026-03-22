import { NextRequest, NextResponse } from "next/server";

import { isForecastOverdue } from "@/lib/analytics/predictions";
import { loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import { buildPortfolioPlanFactSummary } from "@/lib/plan-fact/service";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const runtimeState = getServerRuntimeState();

    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? undefined;
    const snapshot = await loadExecutiveSnapshot({ projectId });
    const planFact = buildPortfolioPlanFactSummary(snapshot, {
      referenceDate: snapshot.generatedAt,
    });

    const predictions = planFact.projects
      .map((summary) => {
        const finishDate = summary.forecastFinishDate;
        const weeksToFinish = finishDate
          ? round(
              Math.max(
                0,
                (new Date(finishDate).getTime() - new Date(summary.referenceDate).getTime()) /
                  (1000 * 60 * 60 * 24 * 7)
              ),
              1
            )
          : null;
        const budgetOverrunRisk = deriveBudgetRisk(summary);
        const scheduleDelayRisk = deriveScheduleRisk(summary);
        const reportingGapRisk =
          summary.evidence.daysSinceLastApprovedReport === null
            ? 10
            : Math.min(100, summary.evidence.daysSinceLastApprovedReport * 15);
        const overallRisk = Math.min(
          100,
          Math.round(budgetOverrunRisk * 0.4 + scheduleDelayRisk * 0.45 + reportingGapRisk * 0.15)
        );

        return {
          projectId: summary.projectId,
          projectName: summary.projectName,
          predictions: {
            finishDate,
            weeksToFinish,
            isOverdue: isForecastOverdue(
              finishDate,
              snapshot.projects.find((project) => project.id === summary.projectId)?.dates.end ??
                null,
              summary.actualProgress
            ),
            velocity: summary.evm.spi !== null ? round(summary.evm.spi, 2) : null,
          },
          risks: {
            budgetOverrun: budgetOverrunRisk,
            scheduleDelay: scheduleDelayRisk,
            reportingGap: reportingGapRisk,
            overall: overallRisk,
          },
          metrics: {
            totalTasks: summary.evidence.totalTasks,
            completedTasks: summary.evidence.completedTasks,
            remainingTasks:
              summary.evidence.totalTasks - summary.evidence.completedTasks,
            completionRate: Math.round(summary.actualProgress),
            approvedWorkReports: summary.evidence.approvedWorkReports,
          },
        };
      })
      .sort((left, right) => right.risks.overall - left.risks.overall);

    return NextResponse.json({
      predictions,
      summary: {
        totalProjects: predictions.length,
        highRisk: predictions.filter((project) => project.risks.overall >= 70).length,
        mediumRisk: predictions.filter(
          (project) => project.risks.overall >= 40 && project.risks.overall < 70
        ).length,
        lowRisk: predictions.filter((project) => project.risks.overall < 40).length,
      },
    });
  } catch (error) {
    return serverError(error, "Failed to fetch analytics predictions.");
  }
}

function deriveBudgetRisk(summary: {
  budgetVarianceRatio: number;
  evm: { cpi: number | null; ac: number; bac: number };
}) {
  const ratioRisk = Math.max(0, summary.budgetVarianceRatio) * 220;
  const cpiRisk =
    summary.evm.cpi !== null && summary.evm.cpi < 1 ? (1 - summary.evm.cpi) * 120 : 0;
  const bacRisk = summary.evm.ac > summary.evm.bac ? 25 : 0;

  return Math.min(100, Math.round(ratioRisk + cpiRisk + bacRisk));
}

function deriveScheduleRisk(summary: {
  progressVariance: number;
  daysToDeadline: number;
  evm: { spi: number | null };
  evidence: { overdueTasks: number };
}) {
  const progressRisk = summary.progressVariance < 0 ? Math.abs(summary.progressVariance) * 3 : 0;
  const spiRisk =
    summary.evm.spi !== null && summary.evm.spi < 1 ? (1 - summary.evm.spi) * 100 : 0;
  const deadlineRisk = summary.daysToDeadline < 0 ? 35 : summary.daysToDeadline <= 14 ? 15 : 0;
  const overdueRisk = summary.evidence.overdueTasks * 8;

  return Math.min(100, Math.round(progressRisk + spiRisk + deadlineRisk + overdueRisk));
}

function round(value: number, digits: number) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
