import { BriefsPage } from "@/components/briefs/briefs-page";
import { listRecentBriefDeliveryLedger } from "@/lib/briefs/delivery-ledger";
import { generatePortfolioBriefFromSnapshot, generateProjectBriefFromSnapshot } from "@/lib/briefs/generate";
import { DEFAULT_BRIEF_LOCALE } from "@/lib/briefs/locale";
import { loadExecutiveSnapshotSafe } from "@/lib/briefs/snapshot-safe";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { KnowledgeLoopOverview } from "@/lib/knowledge";
import { getKnowledgeLoopOverview } from "@/lib/knowledge";
import { getServerRuntimeState, canReadLiveOperatorData } from "@/lib/server/runtime-mode";
import { buildBriefsRuntimeTruth } from "@/lib/server/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyKnowledgeLoopOverview = (generatedAt: string): KnowledgeLoopOverview => ({
  generatedAt,
  summary: {
    totalPlaybooks: 0,
    repeatedPlaybooks: 0,
    benchmarkedGuidance: 0,
    trackedPatterns: 0,
  },
  playbooks: [],
  activeGuidance: [],
});

export default async function BriefsRoute() {
  const runtimeState = getServerRuntimeState();
  const liveDataReady = canReadLiveOperatorData(runtimeState);
  const referenceDate = new Date();

  const snapshotResult = liveDataReady
    ? await loadExecutiveSnapshotSafe({ generatedAt: referenceDate })
    : {
        snapshot: {
          generatedAt: referenceDate.toISOString(),
          projects: [],
          tasks: [],
          risks: [],
          milestones: [],
          workReports: [],
          teamMembers: [],
        },
        usingFallback: true,
      };

  const snapshot = snapshotResult.snapshot;
  const locale = DEFAULT_BRIEF_LOCALE;

  const portfolioBrief = generatePortfolioBriefFromSnapshot(snapshot, {
    locale,
    referenceDate,
  });
  const projectBriefs = snapshot.projects.map((project) =>
    generateProjectBriefFromSnapshot(snapshot, project.id, {
      locale,
      referenceDate,
    })
  );
  const projectOptions = snapshot.projects.map((project) => ({
    id: project.id,
    name: project.name,
  }));

  let knowledgeLoop: KnowledgeLoopOverview = emptyKnowledgeLoopOverview(snapshot.generatedAt);
  let knowledgeLoopAvailabilityNote: string | undefined;
  if (liveDataReady) {
    try {
      knowledgeLoop = await getKnowledgeLoopOverview({ limit: 4 });
    } catch (error) {
      knowledgeLoopAvailabilityNote =
        "Live knowledge loop unavailable; showing an explicit empty state.";
      console.error("[Briefs] Failed to load knowledge loop:", error);
    }
  } else {
    knowledgeLoopAvailabilityNote = "Knowledge loop unavailable without a live database connection.";
  }

  let deliveryLedgerEntries: BriefDeliveryLedgerRecord[] = [];
  let deliveryLedgerAvailabilityNote: string | undefined;
  if (liveDataReady) {
    try {
      deliveryLedgerEntries = await listRecentBriefDeliveryLedger(8);
    } catch (error) {
      deliveryLedgerAvailabilityNote =
        "Live delivery ledger unavailable; showing an explicit empty state.";
      console.error("[Briefs] Failed to load delivery ledger:", error);
    }
  } else {
    deliveryLedgerAvailabilityNote = "Delivery ledger unavailable without a live database connection.";
  }

  const runtimeTruth = buildBriefsRuntimeTruth({
    runtime: runtimeState,
    portfolioAlertCount: portfolioBrief.topAlerts.length,
    projectBriefCount: projectBriefs.length,
    telegramConnector: null,
    emailConnector: null,
  });

  const fallbackNote = snapshotResult.usingFallback
    ? "Live brief snapshot unavailable; showing an explicit empty state instead of demo content."
    : undefined;

  return (
    <BriefsPage
      deliveryLedgerAvailabilityNote={deliveryLedgerAvailabilityNote}
      deliveryLedgerEntries={deliveryLedgerEntries}
      fallbackNote={fallbackNote}
      knowledgeLoop={knowledgeLoop}
      knowledgeLoopAvailabilityNote={knowledgeLoopAvailabilityNote}
      portfolioBrief={portfolioBrief}
      projectBriefs={projectBriefs}
      projectOptions={projectOptions}
      runtimeTruth={runtimeTruth}
    />
  );
}
