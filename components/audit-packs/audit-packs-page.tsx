import Link from "next/link";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  WorkflowAuditPack,
  WorkflowAuditPackCandidate,
} from "@/lib/audit-packs";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import { buildPilotFeedbackPrefillHref } from "@/lib/pilot-feedback/types";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Получить список workflow-кандидатов, для которых можно собрать deterministic audit pack.",
    path: "/api/audit-packs/workflows?limit=12",
  },
  {
    method: "GET" as const,
    note: "Собрать audit pack как JSON artifact с evidence, trace и decision context.",
    path: "/api/audit-packs/workflows/:runId",
  },
  {
    method: "GET" as const,
    note: "Скачать audit pack в markdown without office-document generation.",
    path: "/api/audit-packs/workflows/:runId?format=markdown&download=1",
  },
];

function statusVariant(status: WorkflowAuditPackCandidate["status"]) {
  switch (status) {
    case "done":
      return "success";
    case "failed":
      return "danger";
    case "needs_approval":
      return "warning";
    case "running":
      return "info";
    case "queued":
    default:
      return "neutral";
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AuditPacksPage({
  candidates,
  liveAuditReady,
  pack,
  runtimeTruth,
}: {
  candidates: WorkflowAuditPackCandidate[];
  liveAuditReady: boolean;
  pack: WorkflowAuditPack | null;
  runtimeTruth: OperatorRuntimeTruth;
}) {
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/command-center">
              Open command center
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/work-reports">
              Open work reports
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-feedback">
              Open pilot feedback
            </Link>
          </>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          {
            label:
              candidates.length > 0
                ? `${candidates.length} exportable workflow${candidates.length === 1 ? "" : "s"}`
                : "No workflows loaded",
            variant: candidates.length > 0 ? "info" : "warning",
          },
          {
            label: pack ? `Generated ${formatTimestamp(pack.scope.generatedAt)}` : "No artifact generated",
            variant: pack ? "success" : "neutral",
          },
          {
            label: pack?.decision.status ? `Decision ${pack.decision.status}` : "Decision n/a",
            variant: pack?.decision.status === "applied" ? "success" : pack?.decision.status === "pending" ? "warning" : "info",
          },
        ]}
        description="Один operator-facing export surface для pilot review. Здесь можно выбрать workflow, собрать audit pack поверх persisted evidence и AI trace, а затем скачать deterministic markdown artifact без ручной сборки скриншотов."
        eyebrow="Audit readiness"
        title="Audit Packs"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Exportable workflows</CardTitle>
            <CardDescription>
              Persisted `work_report_signal_packet` runs that already have enough traceability to assemble a pilot-grade audit pack.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {liveAuditReady ? (
              candidates.length > 0 ? (
                candidates.map((candidate) => {
                  const isSelected = pack?.scope.runId === candidate.runId;

                  return (
                    <Link
                      className={`rounded-[14px] border p-4 transition-colors ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--panel-soft)]"
                          : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-[var(--line-strong)]"
                      }`}
                      href={`/audit-packs?runId=${candidate.runId}`}
                      key={candidate.runId}
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={statusVariant(candidate.status)}>{candidate.status}</Badge>
                        {candidate.purposeLabel ? <Badge variant="info">{candidate.purposeLabel}</Badge> : null}
                        {candidate.hasAppliedDecision ? <Badge variant="success">applied</Badge> : null}
                      </div>
                      <div className="mt-3 text-sm font-medium text-[var(--ink)]">
                        {candidate.packetLabel ?? candidate.sourceEntityLabel}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {candidate.projectName ?? "No linked project"}
                      </div>
                      <div className="mt-2 text-xs text-[var(--ink-muted)]">
                        Run {candidate.runId} · Updated {formatTimestamp(candidate.updatedAt)}
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                  No exportable workflows yet. Create a work-report signal packet first, then return here to assemble an audit pack.
                </div>
              )
            ) : (
              <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                Demo mode or missing live database configuration keeps audit-pack export in a safe preview state.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Audit artifact</CardTitle>
                <CardDescription>
                  Deterministic pack with explicit scope, evidence, trace steps, and operator decision context.
                </CardDescription>
              </div>
              {pack ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    href={buildPilotFeedbackPrefillHref({
                      projectId: pack.scope.projectId,
                      projectName: pack.scope.projectName,
                      sourceHref: `/audit-packs?runId=${pack.scope.runId}`,
                      sourceLabel: "Audit pack workflow",
                      targetId: pack.scope.runId,
                      targetLabel: pack.scope.packetLabel ?? pack.scope.sourceEntityLabel,
                      targetType: "workflow_run",
                    })}
                  >
                    Log feedback
                  </Link>
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    href={`/api/audit-packs/workflows/${pack.scope.runId}?format=markdown&download=1`}
                  >
                    Download markdown
                  </Link>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {pack ? (
              <>
                <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Scope</div>
                    <div className="mt-1 font-medium text-[var(--ink)]">{pack.scope.packetLabel ?? pack.scope.sourceEntityLabel}</div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">{pack.scope.projectName ?? "No linked project"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Evidence</div>
                    <div className="mt-1 font-medium text-[var(--ink)]">{pack.evidence.records.length} records</div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">Sync {pack.evidence.sync?.status ?? "idle"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Trace</div>
                    <div className="mt-1 font-medium text-[var(--ink)]">{pack.trace.model.name}</div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">{pack.trace.status}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Decision</div>
                    <div className="mt-1 font-medium text-[var(--ink)]">{pack.decision.status}</div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">{formatTimestamp(pack.scope.generatedAt)}</div>
                  </div>
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                  <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Evidence scope</div>
                    <div className="mt-3 grid gap-3 text-sm text-[var(--ink-soft)]">
                      {pack.evidence.records.length > 0 ? (
                        pack.evidence.records.map((record) => (
                          <div key={record.id} className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-3">
                            <div className="font-medium text-[var(--ink)]">{record.title}</div>
                            <div className="mt-1 text-xs text-[var(--ink-muted)]">
                              {record.verificationStatus} · confidence {record.confidence} · observed {formatTimestamp(record.observedAt)}
                            </div>
                            <div className="mt-2 text-sm">{record.summary ?? "No summary"}</div>
                          </div>
                        ))
                      ) : (
                        <div>No persisted evidence records matched this workflow source.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Decision context</div>
                    <div className="mt-3 text-sm text-[var(--ink)]">{pack.decision.operatorSummary}</div>
                    <div className="mt-3 grid gap-2 text-sm text-[var(--ink-soft)]">
                      <div>Proposal: {pack.decision.proposal?.title ?? "None"}</div>
                      <div>Proposal state: {pack.decision.proposal?.state ?? "n/a"}</div>
                      <div>Apply summary: {pack.decision.applyResult?.summary ?? "No applied result recorded"}</div>
                      <div>Applied at: {formatTimestamp(pack.decision.applyResult?.appliedAt)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Source links</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pack.sourceLinks.map((link) => (
                      <Link
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={link.href}
                        key={`${pack.scope.runId}:${link.href}`}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Artifact preview</div>
                  <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-xs leading-6 text-[var(--ink-soft)]">
                    {pack.artifact.content}
                  </pre>
                </div>
              </>
            ) : (
              <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                Select a workflow to assemble an audit pack.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DomainApiCard
        description="Audit packs reuse existing run, trace, and evidence layers, but expose one deterministic export artifact for pilot stakeholders."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
