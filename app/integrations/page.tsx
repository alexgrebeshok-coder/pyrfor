import { ErrorBoundary } from "@/components/error-boundary";
import { IntegrationsPage } from "@/components/integrations/integrations-page";
import {
  getConnectorRegistry,
  summarizeConnectorStatuses,
} from "@/lib/connectors";
import {
  getEnterpriseTruthOverview,
  getReconciliationCasefiles,
  type ReconciliationCasefileListResult,
} from "@/lib/enterprise-truth";
import { getGpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import { getOneCFinanceTruthSnapshot } from "@/lib/connectors/one-c-client";
import { getEvidenceFusionOverview, getEvidenceLedgerOverview } from "@/lib/evidence";
import { canReadLiveOperatorData, getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildIntegrationsRuntimeTruth } from "@/lib/server/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function IntegrationsRoute() {
  const runtimeState = getServerRuntimeState();
  const liveOperatorDataReady = canReadLiveOperatorData(runtimeState);
  const emptyCasefiles: ReconciliationCasefileListResult = {
    syncedAt: null,
    summary: {
      total: 0,
      open: 0,
      resolved: 0,
      corroborated: 0,
      contradictory: 0,
      partial: 0,
      projectCases: 0,
      telemetryGaps: 0,
    },
    cases: [],
    sync: null,
  };
  const reconciliationPromise = liveOperatorDataReady
    ? getReconciliationCasefiles({ limit: 24 }).catch(() => emptyCasefiles)
    : Promise.resolve(emptyCasefiles);

  const [connectors, gpsTelemetry, oneCFinance, reconciliation] =
    await Promise.all([
      getConnectorRegistry().getStatuses(),
      getGpsTelemetryTruthSnapshot(),
      getOneCFinanceTruthSnapshot(),
      reconciliationPromise,
    ]);
  const summary = summarizeConnectorStatuses(connectors);
  const evidence = liveOperatorDataReady
    ? await getEvidenceLedgerOverview(
        { limit: 24 },
        {
          gpsSnapshot: gpsTelemetry,
          listReports: async () => [],
        }
      ).catch(() => ({
        syncedAt: null,
        summary: {
          total: 0,
          reported: 0,
          observed: 0,
          verified: 0,
          averageConfidence: null,
          lastObservedAt: null,
        },
        records: [],
        sync: null,
      }))
    : {
        syncedAt: null,
        summary: {
          total: 0,
          reported: 0,
          observed: 0,
          verified: 0,
          averageConfidence: null,
          lastObservedAt: null,
        },
        records: [],
        sync: null,
      };
  const fusion = liveOperatorDataReady
    ? await getEvidenceFusionOverview(
        { limit: 4 },
        {
          evidence,
        }
      ).catch(() => ({
        syncedAt: new Date().toISOString(),
        summary: {
          total: 0,
          reported: 0,
          observed: 0,
          verified: 0,
          averageConfidence: null,
          strongestFactTitle: null,
        },
        facts: [],
      }))
    : {
        syncedAt: new Date().toISOString(),
        summary: {
          total: 0,
          reported: 0,
          observed: 0,
          verified: 0,
          averageConfidence: null,
          strongestFactTitle: null,
        },
        facts: [],
      };
  const enterpriseTruth = liveOperatorDataReady
    ? await getEnterpriseTruthOverview(
        { limit: 4, telemetryLimit: 3 },
        {
          evidence,
          fusion,
          gpsSample: gpsTelemetry,
          oneCSample: oneCFinance,
        }
      ).catch(() => ({
        syncedAt: new Date().toISOString(),
        summary: {
          totalProjects: 0,
          corroborated: 0,
          fieldOnly: 0,
          financeOnly: 0,
          telemetryGaps: 0,
          largestVarianceProject: null,
        },
        projects: [],
        telemetryGaps: [],
      }))
    : {
        syncedAt: new Date().toISOString(),
        summary: {
          totalProjects: 0,
          corroborated: 0,
          fieldOnly: 0,
          financeOnly: 0,
          telemetryGaps: 0,
          largestVarianceProject: null,
        },
        projects: [],
        telemetryGaps: [],
      };
  const runtimeTruth = buildIntegrationsRuntimeTruth({
    connectorSummary: summary,
    evidenceCount: evidence.summary.total,
    gpsSample: gpsTelemetry,
    oneCSample: oneCFinance,
    runtime: runtimeState,
  });

  return (
    <ErrorBoundary resetKey="integrations">
      <IntegrationsPage
        connectors={connectors}
        evidence={evidence}
        enterpriseTruth={enterpriseTruth}
        fusion={fusion}
        gpsTelemetry={gpsTelemetry}
        oneCFinance={oneCFinance}
        reconciliation={reconciliation}
        runtimeTruth={runtimeTruth}
        summary={summary}
      />
    </ErrorBoundary>
  );
}
