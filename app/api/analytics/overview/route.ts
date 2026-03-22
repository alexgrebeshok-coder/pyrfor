import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";

import { loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import { buildPortfolioPlanFactSummary } from "@/lib/plan-fact/service";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Require authentication
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }


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

    const projects = planFact.projects.map((summary) => {
      const projectTasks = snapshot.tasks.filter((task) => task.projectId === summary.projectId);

      return {
        projectId: summary.projectId,
        projectName: summary.projectName,
        totalTasks: summary.evidence.totalTasks,
        statusBreakdown: {
          todo: projectTasks.filter((task) => task.status === "todo").length,
          inProgress: projectTasks.filter((task) => task.status === "in-progress").length,
          blocked: summary.evidence.blockedTasks,
          done: summary.evidence.completedTasks,
        },
        priorityBreakdown: {
          high: projectTasks.filter((task) =>
            ["high", "critical"].includes(task.priority)
          ).length,
          medium: projectTasks.filter((task) => task.priority === "medium").length,
          low: projectTasks.filter((task) => task.priority === "low").length,
        },
        progress: Math.round(summary.actualProgress),
        overdueTasks: summary.evidence.overdueTasks,
        healthScore: deriveHealthScore(summary),
        status: summary.status,
        planFact: {
          plannedProgress: summary.plannedProgress,
          actualProgress: summary.actualProgress,
          progressVariance: summary.progressVariance,
          budgetVariance: summary.budgetVariance,
          budgetVarianceRatio: summary.budgetVarianceRatio,
          cpi: summary.evm.cpi,
          spi: summary.evm.spi,
          warningCount: summary.warnings.length,
        },
      };
    });

    return NextResponse.json({
      summary: {
        totalProjects: projects.length,
        totalTasks: projects.reduce((sum, project) => sum + project.totalTasks, 0),
        avgProgress: projects.length
          ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length)
          : 0,
        totalOverdue: projects.reduce((sum, project) => sum + project.overdueTasks, 0),
        avgHealthScore: projects.length
          ? Math.round(
              projects.reduce((sum, project) => sum + project.healthScore, 0) / projects.length
            )
          : 0,
        activeProjects: snapshot.projects.filter((project) =>
          ["active", "planning", "at-risk", "on-hold"].includes(project.status)
        ).length,
        completedProjects: snapshot.projects.filter(
          (project) => project.status === "completed" || project.progress >= 100
        ).length,
        completedTasks: snapshot.tasks.filter((task) => task.status === "done").length,
        overdueTasks: projects.reduce((sum, project) => sum + project.overdueTasks, 0),
        teamSize: snapshot.teamMembers.length,
        averageHealth: projects.length
          ? Math.round(
              projects.reduce((sum, project) => sum + project.healthScore, 0) / projects.length
            )
          : 0,
        planFact: {
          portfolioCpi: planFact.totals.cpi,
          portfolioSpi: planFact.totals.spi,
          projectsBehindPlan: planFact.totals.projectsBehindPlan,
          projectsOverBudget: planFact.totals.projectsOverBudget,
          staleFieldReportingProjects: planFact.totals.staleFieldReportingProjects,
          criticalProjects: planFact.totals.criticalProjects,
        },
      },
      projects,
    });
  } catch (error) {
    return serverError(error, "Failed to fetch analytics overview.");
  }
}

function deriveHealthScore(summary: {
  actualProgress: number;
  budgetVarianceRatio: number;
  evm: { cpi: number | null; spi: number | null };
  warnings: Array<{ severity: string }>;
}) {
  let score = summary.actualProgress;

  if (summary.evm.spi !== null && summary.evm.spi < 1) {
    score -= (1 - summary.evm.spi) * 30;
  }

  if (summary.evm.cpi !== null && summary.evm.cpi < 1) {
    score -= (1 - summary.evm.cpi) * 35;
  }

  score -= Math.max(0, summary.budgetVarianceRatio) * 40;
  score -= summary.warnings.filter((warning) => warning.severity === "critical").length * 12;
  score -= summary.warnings.filter((warning) => warning.severity === "high").length * 6;

  return Math.max(0, Math.min(100, Math.round(score)));
}
