import Link from "next/link";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type { TenantRolloutPacket } from "@/lib/tenant-rollout-packet";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Получить latest rollout handoff packet как JSON поверх readiness, pilot review, decision trail и persisted onboarding runbook.",
    path: "/api/tenant-rollout-packet",
  },
  {
    method: "GET" as const,
    note: "Открыть тот же rollout packet как markdown preview для operator handoff.",
    path: "/api/tenant-rollout-packet?format=markdown",
  },
  {
    method: "GET" as const,
    note: "Скачать deterministic markdown handoff packet для следующего tenant widening conversation.",
    path: "/api/tenant-rollout-packet?format=markdown&download=1",
  },
];

function stateVariant(state: TenantRolloutPacket["handoff"]["state"]) {
  switch (state) {
    case "blocked":
      return "danger";
    case "warning":
      return "warning";
    case "ready":
    default:
      return "success";
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TenantRolloutPacketPage({
  availabilityNote,
  packet,
  runtimeTruth,
}: {
  availabilityNote?: string;
  packet: TenantRolloutPacket;
  runtimeTruth: OperatorRuntimeTruth;
}) {
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);
  const latestRunbook = packet.latestRunbook;
  const targetTenant =
    packet.handoff.targetTenantSlug ??
    packet.handoff.targetTenantLabel ??
    packet.currentReadiness.tenant.slug;

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-onboarding">
              Open tenant onboarding
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-readiness">
              Open tenant readiness
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-review">
              Open pilot review
            </Link>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/api/tenant-rollout-packet?format=markdown&download=1"
            >
              Download markdown
            </Link>
          </>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          { label: packet.handoff.stateLabel, variant: stateVariant(packet.handoff.state) },
          {
            label: latestRunbook ? latestRunbook.statusLabel : "No runbook",
            variant: latestRunbook ? stateVariant(packet.handoff.state) : "warning",
          },
          {
            label: packet.latestDecision?.decisionLabel ?? "No decision",
            variant: packet.latestDecision ? "info" : "warning",
          },
          {
            label: packet.artifact.format.toUpperCase(),
            variant: "info",
          },
        ]}
        description="One operator-facing latest handoff surface. It packages tenant readiness, pilot review, cutover decisions, and the persisted onboarding runbook into one deterministic rollout packet and one markdown export path."
        eyebrow="Rollout handoff"
        title="Tenant Rollout Packet"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.88fr)_minmax(0,1.12fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Latest handoff state</CardTitle>
            <CardDescription>{packet.handoff.summary}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {availabilityNote ? (
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                {availabilityNote}
              </div>
            ) : null}

            <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 grid-cols-1 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Target tenant
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">{targetTenant}</div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  Baseline {packet.currentReadiness.tenant.slug}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Target cutover
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {formatTimestamp(packet.handoff.targetCutoverAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Review artifact
                </div>
                <div className="mt-1 break-words font-medium text-[var(--ink)]">
                  {packet.currentReview.artifact.fileName}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Packet generated
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {formatTimestamp(packet.generatedAt)}
                </div>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Readiness
                </div>
                <div className="mt-1 text-xl font-semibold text-[var(--ink)]">
                  {packet.currentReadiness.outcomeLabel}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Review
                </div>
                <div className="mt-1 text-xl font-semibold text-[var(--ink)]">
                  {packet.currentReview.outcomeLabel}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Latest runbook
                </div>
                <div className="mt-1 text-xl font-semibold text-[var(--ink)]">
                  {latestRunbook?.statusLabel ?? "Not started"}
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {packet.sections.map((section) => (
                <div
                  className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4"
                  key={section.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--ink)]">{section.label}</div>
                      <div className="mt-1 text-sm text-[var(--ink-soft)]">{section.summary}</div>
                    </div>
                    <Badge variant={stateVariant(section.state)}>
                      {section.state}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-1 text-sm text-[var(--ink-soft)]">
                    {section.lines.map((line) => (
                      <div key={`${section.id}:${line}`}>{line}</div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {section.links.map((link) => (
                      <Link
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={link.href}
                        key={`${section.id}:${link.href}`}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Rollout packet artifact</CardTitle>
                <CardDescription>
                  Deterministic markdown handoff over the latest runbook, current readiness,
                  pilot review, and explicit decision trail.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href="/api/tenant-rollout-packet"
                >
                  Open JSON
                </Link>
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href="/api/tenant-rollout-packet?format=markdown&download=1"
                >
                  Download markdown
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Artifact file
                </div>
                <div className="mt-1 break-words font-medium text-[var(--ink)]">
                  {packet.artifact.fileName}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Decision trail
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {packet.latestDecision?.decisionLabel ?? "No decision recorded"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Template version
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">{packet.templateVersion}</div>
              </div>
            </div>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Handoff notes
                </div>
                <div className="mt-3 text-sm text-[var(--ink-soft)]">
                  {latestRunbook?.handoffNotes ?? "Not captured in the latest runbook."}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Operator notes
                </div>
                <div className="mt-3 text-sm text-[var(--ink-soft)]">
                  {latestRunbook?.operatorNotes ?? "Not captured in the latest runbook."}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Rollback plan
                </div>
                <div className="mt-3 text-sm text-[var(--ink-soft)]">
                  {latestRunbook?.rollbackPlan ?? "Not captured in the latest runbook."}
                </div>
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Source links
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {packet.sourceLinks.map((link) => (
                  <Link
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Artifact preview
              </div>
              <pre className="mt-3 max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-xs leading-6 text-[var(--ink-soft)]">
                {packet.artifact.content}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <DomainApiCard
        description="The rollout packet stays narrow: one latest handoff artifact over existing readiness, review, decision, and onboarding state without adding a provisioning workflow engine."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
