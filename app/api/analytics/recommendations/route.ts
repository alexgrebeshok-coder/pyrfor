import { NextRequest, NextResponse } from "next/server";

import { loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import { buildPortfolioPlanFactSummary } from "@/lib/plan-fact/service";
import type { PlanFactWarning } from "@/lib/plan-fact/types";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecommendationRecord = {
  type: "budget" | "timeline" | "delivery" | "governance";
  priority: "critical" | "high" | "medium" | "low";
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  action: string;
};

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

    const recommendations = planFact.projects
      .flatMap<RecommendationRecord>((summary) =>
        summary.warnings.map((warning) => mapWarningToRecommendation(summary.projectId, summary.projectName, warning))
      )
      .sort(compareRecommendations);

    return NextResponse.json({
      recommendations,
      summary: {
        total: recommendations.length,
        critical: recommendations.filter((item) => item.priority === "critical").length,
        high: recommendations.filter((item) => item.priority === "high").length,
        medium: recommendations.filter((item) => item.priority === "medium").length,
        low: recommendations.filter((item) => item.priority === "low").length,
      },
    });
  } catch (error) {
    return serverError(error, "Failed to fetch analytics recommendations.");
  }
}

function mapWarningToRecommendation(
  projectId: string,
  projectName: string,
  warning: PlanFactWarning
): RecommendationRecord {
  switch (warning.code) {
    case "SCHEDULE_DRIFT":
      return {
        type: "timeline",
        priority: mapSeverity(warning.severity),
        projectId,
        projectName,
        title: "Rebaseline near-term execution window",
        description: `${projectName}: ${warning.summary}`,
        action: "Protect the next two weeks of critical work, clear blocked tasks, and assign a single recovery owner.",
      };
    case "COST_PRESSURE":
      if (warning.metrics?.overspending === 1) {
        return {
          type: "budget",
          priority: mapSeverity(warning.severity),
          projectId,
          projectName,
          title: "Freeze non-essential spend and validate scope",
          description: `${projectName}: ${warning.summary}`,
          action: "Review spend line items, confirm scope-to-budget fit, and decide which recovery actions still get funded.",
        };
      }

      return {
        type: "budget",
        priority: mapSeverity(warning.severity),
        projectId,
        projectName,
        title: "Reset cost efficiency before adding scope",
        description: `${projectName}: ${warning.summary}`,
        action: "Review execution productivity, confirm delivered scope against spend, and avoid adding new commitments until CPI recovers.",
      };
    case "MILESTONE_RISK":
      return {
        type: "timeline",
        priority: mapSeverity(warning.severity),
        projectId,
        projectName,
        title: "Protect the next milestone explicitly",
        description: `${projectName}: ${warning.summary}`,
        action: "Confirm milestone exit criteria and move non-protective work out of the immediate delivery window.",
      };
    case "STALE_FIELD_REPORTING":
      return {
        type: "delivery",
        priority: mapSeverity(warning.severity),
        projectId,
        projectName,
        title: "Restore fresh field evidence",
        description: `${projectName}: ${warning.summary}`,
        action: "Reinstate the daily field-report rhythm before making the next schedule or budget decision.",
      };
    case "REVIEW_BACKLOG":
      return {
        type: "governance",
        priority: mapSeverity(warning.severity),
        projectId,
        projectName,
        title: "Clear work-report review backlog",
        description: `${projectName}: ${warning.summary}`,
        action: "Assign a reviewer this week and close the pending report queue to recover signal quality.",
      };
    case "LOW_DELIVERY_CONFIDENCE":
    default:
      return {
        type: "delivery",
        priority: "low",
        projectId,
        projectName,
        title: "Increase operational evidence density",
        description: `${projectName}: ${warning.summary}`,
        action: "Increase discipline in task updates, milestone confirmation, and field reporting before escalating the project.",
      };
  }
}

function mapSeverity(severity: PlanFactWarning["severity"]): RecommendationRecord["priority"] {
  return severity;
}

function compareRecommendations(left: RecommendationRecord, right: RecommendationRecord) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return order[left.priority] - order[right.priority];
}
