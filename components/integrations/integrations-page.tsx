import Link from "next/link";

import { ConnectorHealthTable } from "@/components/integrations/connector-health-table";
import { EnterpriseTruthCard } from "@/components/integrations/enterprise-truth-card";
import { EvidenceFusionCard } from "@/components/integrations/evidence-fusion-card";
import { ConnectorPolicyForm } from "@/components/integrations/connector-policy-form";
import { IntegrationManifestsCard } from "@/components/integrations/integration-manifests-card";
import { EvidenceLedgerCard } from "@/components/integrations/evidence-ledger-card";
import { GpsTelemetryTruthCard } from "@/components/integrations/gps-telemetry-truth-card";
import { IntegrationsOverviewCard } from "@/components/integrations/integrations-overview-card";
import { OneCExpenseSyncCard } from "@/components/integrations/one-c-expense-sync-card";
import { OneCFinanceTruthCard } from "@/components/integrations/one-c-finance-truth-card";
import { ReconciliationCasefilesCard } from "@/components/integrations/reconciliation-casefiles-card";
import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { buttonVariants } from "@/components/ui/button";
import type { ConnectorStatus, ConnectorStatusSummary } from "@/lib/connectors";
import type {
  EnterpriseTruthOverview,
  ReconciliationCasefileListResult,
} from "@/lib/enterprise-truth";
import type { GpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import type { OneCFinanceTruthSnapshot } from "@/lib/connectors/one-c-client";
import type { EvidenceFusionOverview, EvidenceListResult } from "@/lib/evidence";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Получить полный registry-backed список connector statuses и summary.",
    path: "/api/connectors",
  },
  {
    method: "GET" as const,
    note: "Получить статус одного connector по его id.",
    path: "/api/connectors/:connectorId",
  },
  {
    method: "GET" as const,
    note: "Прочитать один live GPS telemetry sample через sessions-based read path.",
    path: "/api/connectors/gps/sample",
  },
  {
    method: "GET" as const,
    note: "Прочитать нормализованную GPS telemetry truth с session, equipment и geofence rollups.",
    path: "/api/connectors/gps/telemetry",
  },
  {
    method: "GET" as const,
    note: "Прочитать один live 1C finance sample через read-only project financials path.",
    path: "/api/connectors/one-c/sample",
  },
  {
    method: "GET" as const,
    note: "Прочитать нормализованную 1C financial truth с project deltas и portfolio rollups.",
    path: "/api/connectors/one-c/finance",
  },
  {
    method: "GET" as const,
    note: "Построить preview того, как 1C financial truth будет сопоставлен в Expense latest snapshots.",
    path: "/api/connectors/one-c/expenses",
  },
  {
    method: "POST" as const,
    note: "Выполнить upsert 1C actual budget snapshots в Expense через deterministic mapper.",
    path: "/api/connectors/one-c/expenses",
  },
  {
    method: "POST" as const,
    note: "Запустить scheduled 1C expense sync через cron-safe endpoint с CRON_SECRET и SSE broadcast.",
    path: "/api/connectors/one-c/expenses/run-due",
  },
  {
    method: "GET" as const,
    note: "Прочитать sample snapshot через optional 1C OData adapter для counterparties и receipt documents.",
    path: "/api/connectors/one-c/odata",
  },
  {
    method: "GET" as const,
    note: "Прочитать persisted evidence ledger и freshness последнего derived sync.",
    path: "/api/evidence",
  },
  {
    method: "POST" as const,
    note: "Явно запустить derived sync job для evidence ledger по work reports и GPS sample.",
    path: "/api/evidence/sync",
  },
  {
    method: "GET" as const,
    note: "Посмотреть fused confidence rollup по work reports, GPS telemetry и visual evidence.",
    path: "/api/evidence/fusion",
  },
  {
    method: "GET" as const,
    note: "Построить enterprise truth rollup по 1C finance, field evidence и unmatched telemetry.",
    path: "/api/enterprise-truth?limit=4&telemetryLimit=3",
  },
  {
    method: "GET" as const,
    note: "Прочитать persisted reconciliation casefiles и inspectable mismatch reasons.",
    path: "/api/reconciliation/casefiles?limit=12",
  },
  {
    method: "POST" as const,
    note: "Явно запустить reconciliation sync и пересобрать casefiles из finance, field evidence и telemetry.",
    path: "/api/reconciliation/sync",
  },
  {
    method: "GET" as const,
    note: "Получить один evidence record по id.",
    path: "/api/evidence/:evidenceId",
  },
  {
    method: "POST" as const,
    note: "Разобрать confidence конкретного evidence record: support, gaps, anomalies и fused justification.",
    path: "/api/evidence/analyze",
  },
  {
    method: "GET" as const,
    note: "Проверить общую готовность runtime и агрегированный connector health.",
    path: "/api/health",
  },
];

export function IntegrationsPage({
  connectors,
  evidence,
  enterpriseTruth,
  fusion,
  gpsTelemetry,
  oneCFinance,
  reconciliation,
  runtimeTruth,
  summary,
}: {
  connectors: ConnectorStatus[];
  evidence: EvidenceListResult;
  enterpriseTruth: EnterpriseTruthOverview;
  fusion: EvidenceFusionOverview;
  gpsTelemetry: GpsTelemetryTruthSnapshot;
  oneCFinance: OneCFinanceTruthSnapshot;
  reconciliation: ReconciliationCasefileListResult;
  runtimeTruth: OperatorRuntimeTruth;
  summary: ConnectorStatusSummary;
}) {
  const liveConnectors = connectors.filter((connector) => !connector.stub).length;
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);
  const gpsSampleLabel =
    gpsTelemetry.status === "ok"
      ? "GPS truth live"
      : gpsTelemetry.status === "degraded"
        ? "GPS truth degraded"
        : "GPS truth pending";
  const oneCSampleLabel =
    oneCFinance.status === "ok"
      ? "1C truth live"
      : oneCFinance.status === "degraded"
        ? "1C truth degraded"
        : "1C truth pending";

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/settings">
            Compare runtime settings
          </Link>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          { label: "Registry-backed", variant: "success" },
          { label: summary.pending > 0 ? "Secrets required" : "Configured", variant: summary.pending > 0 ? "warning" : "success" },
          { label: liveConnectors > 0 ? `${liveConnectors} live probe${liveConnectors === 1 ? "" : "s"}` : "Stub adapters", variant: liveConnectors > 0 ? "success" : "info" },
          { label: gpsSampleLabel, variant: gpsTelemetry.status === "ok" ? "success" : gpsTelemetry.status === "degraded" ? "danger" : "warning" },
          { label: oneCSampleLabel, variant: oneCFinance.status === "ok" ? "success" : oneCFinance.status === "degraded" ? "danger" : "warning" },
          { label: enterpriseTruth.summary.corroborated > 0 ? `${enterpriseTruth.summary.corroborated} corroborated project truth${enterpriseTruth.summary.corroborated === 1 ? "" : "s"}` : "Enterprise truth expanding", variant: enterpriseTruth.summary.corroborated > 0 ? "success" : "info" },
          { label: evidence.summary.total > 0 ? `${evidence.summary.total} evidence record${evidence.summary.total === 1 ? "" : "s"}` : "Evidence pending", variant: evidence.summary.total > 0 ? "info" : "warning" },
        ]}
        description="Раздел интеграций подключён к реальному connector registry. Здесь видно, какие коннекторы уже дают live probes, каких secrets не хватает, какой API surface уже подготовлен, какие read-only truth slices реально приходят из GPS и 1C, как эти факты вместе с visual evidence попадают в evidence ledger и где enterprise truth уже corroborated, а где ещё остаются explainable finance-only или field-only gaps."
        eyebrow="Platform trust"
        title="Connector Health"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <IntegrationsOverviewCard summary={summary} />

      <IntegrationManifestsCard />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <ConnectorHealthTable connectors={connectors} />
        <div className="grid gap-4">
          <GpsTelemetryTruthCard snapshot={gpsTelemetry} />
          <OneCFinanceTruthCard snapshot={oneCFinance} />
          <OneCExpenseSyncCard />
          <EvidenceFusionCard fusion={fusion} />
          <EnterpriseTruthCard overview={enterpriseTruth} />
          <ReconciliationCasefilesCard result={reconciliation} />
          <EvidenceLedgerCard evidence={evidence} />
          <ConnectorPolicyForm connectors={connectors} />
        </div>
      </div>

      <DomainApiCard
        description="Страница уже использует реальные backend endpoints и совпадает с текущим connector framework."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
