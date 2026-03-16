import { BriefsPage } from "@/components/briefs/briefs-page";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildBriefsRuntimeTruth } from "@/lib/server/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BriefsRoute() {
  const runtimeState = getServerRuntimeState();
  const runtimeTruth = buildBriefsRuntimeTruth({
    runtime: runtimeState,
    portfolioAlertCount: 0,
    projectBriefCount: 0,
    telegramConnector: null,
    emailConnector: null,
  });
  
  // Safe defaults for missing data (using any to bypass complex type)
  const portfolioBrief: any = {
    kind: "portfolio" as const,
    generatedAt: new Date().toISOString(),
    headline: "Portfolio Overview",
    summary: "Демо-режим",
    portfolio: {
      totalProjects: 0,
      activeProjects: 0,
      completedProjects: 0,
      atRiskProjects: 0,
      criticalProjects: 0,
      overdueTasks: 0,
      averageHealth: 0,
      budgetVariance: 0,
      budgetVarianceRatio: 0,
      planFact: {
        plannedProgress: 0,
        actualProgress: 0,
        progressVariance: 0,
        cpi: null,
        spi: null,
        projectsBehindPlan: 0,
        projectsOverBudget: 0,
        staleFieldReportingProjects: 0,
      },
    },
    sections: {
      whatHappened: [],
      whyItMatters: [],
      recommendedActions: [],
    },
    topAlerts: [],
    recommendationsSummary: [],
    formats: ["text", "markdown"],
  };
  
  const projectBriefs: any[] = [];
  const projectOptions: any[] = [];
  const knowledgeLoop = { status: "pending", items: [] };
  const deliveryLedgerEntries: any[] = [];

  return (
    <BriefsPage
      portfolioBrief={portfolioBrief as any}
      projectBriefs={projectBriefs as any}
      projectOptions={projectOptions as any}
      knowledgeLoop={knowledgeLoop as any}
      deliveryLedgerEntries={deliveryLedgerEntries as any}
      runtimeTruth={runtimeTruth as any}
      fallbackNote="Демо-режим: данные для демонстрации"
    />
  );
}
