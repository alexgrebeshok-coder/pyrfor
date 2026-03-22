import Link from "next/link";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { TenantOnboardingRunbookPanel } from "@/components/tenant-onboarding/tenant-onboarding-runbook-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type {
  TenantOnboardingOverview,
  TenantOnboardingRunbookRecord,
  TenantOnboardingTemplateItem,
} from "@/lib/tenant-onboarding";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Прочитать latest rollout-preparation baseline, template items и persisted runbook entries.",
    path: "/api/tenant-onboarding",
  },
  {
    method: "POST" as const,
    note: "Создать новый persisted rollout runbook entry на базе текущих readiness/review/decision snapshots.",
    path: "/api/tenant-onboarding",
  },
  {
    method: "PATCH" as const,
    note: "Обновить target tenant, handoff notes, rollback plan или status текущего runbook entry.",
    path: "/api/tenant-onboarding/:id",
  },
  {
    method: "GET" as const,
    note: "Открыть текущий cutover baseline, который теперь служит входом для runbook template.",
    path: "/api/tenant-readiness",
  },
  {
    method: "GET" as const,
    note: "Открыть governance artifact, который теперь служит attachable review baseline для onboarding runbook.",
    path: "/api/pilot-review",
  },
  {
    method: "GET" as const,
    note: "Открыть latest rollout handoff packet как deterministic JSON surface поверх runbook, readiness, review и decision trail.",
    path: "/api/tenant-rollout-packet",
  },
];

function outcomeVariant(outcome: TenantOnboardingOverview["currentReadiness"]["outcome"]) {
  switch (outcome) {
    case "blocked":
      return "danger";
    case "guarded":
      return "warning";
    case "ready_with_warnings":
      return "info";
    case "ready":
    default:
      return "success";
  }
}

function stateVariant(state: TenantOnboardingTemplateItem["state"]) {
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

function statusVariant(status: TenantOnboardingRunbookRecord["status"]) {
  switch (status) {
    case "completed":
      return "success";
    case "scheduled":
      return "info";
    case "prepared":
      return "warning";
    case "draft":
    default:
      return "neutral";
  }
}

function formatStateLabel(state: TenantOnboardingTemplateItem["state"]) {
  switch (state) {
    case "blocked":
      return "blocked";
    case "warning":
      return "warning";
    case "ready":
    default:
      return "ready";
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function prepCopy(overview: TenantOnboardingOverview) {
  if (overview.currentReadiness.outcome === "blocked") {
    return "The baseline tenant is still blocked. Use this surface to prepare the rollout conversation, but do not treat it as a promotion-ready handoff yet.";
  }

  if (
    overview.currentReadiness.outcome === "guarded" ||
    overview.currentReview.outcome === "guarded"
  ) {
    return "The baseline is usable, but wider rollout still sits inside explicit guardrails. Capture the handoff and rollback posture before widening.";
  }

  if (
    overview.currentReadiness.outcome === "ready_with_warnings" ||
    overview.currentReview.outcome === "ready_with_warnings"
  ) {
    return "The baseline is close to ready. Persist the warning context and next-tenant handoff notes so the rollout discussion can be repeated without guesswork.";
  }

  return "The current baseline is clear enough to reuse. Persist the target tenant, handoff notes, and rollback posture as the repeatable rollout package.";
}

function TemplateCard({
  items,
}: {
  items: TenantOnboardingTemplateItem[];
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Rollout template</CardTitle>
        <CardDescription>
          One narrow template over readiness, governance review, cutover decisions, and
          persisted handoff state.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((item) => (
          <div
            className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
            key={item.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--ink)]">{item.label}</div>
                <div className="mt-1 text-sm text-[var(--ink-soft)]">{item.summary}</div>
              </div>
              <Badge variant={stateVariant(item.state)}>{formatStateLabel(item.state)}</Badge>
            </div>
            <div className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Current value
            </div>
            <div className="mt-1 text-sm font-medium text-[var(--ink)]">{item.value}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.links.map((link) => (
                <Link
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  href={link.href}
                  key={`${item.id}:${link.href}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TenantOnboardingPage({
  availabilityNote,
  overview,
  runtimeTruth,
}: {
  availabilityNote?: string;
  overview: TenantOnboardingOverview;
  runtimeTruth: OperatorRuntimeTruth;
}) {
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);
  const latestRunbook = overview.latestRunbook;
  const latestDecisionLabel = overview.latestDecision?.decisionLabel ?? "No decision yet";

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-readiness">
              Open tenant readiness
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-review">
              Open pilot review
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-rollout-packet">
              Open rollout packet
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-controls">
              Open pilot controls
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/command-center">
              Open command center
            </Link>
          </>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          {
            label: overview.currentReadiness.outcomeLabel,
            variant: outcomeVariant(overview.currentReadiness.outcome),
          },
          {
            label: overview.currentReview.outcomeLabel,
            variant: outcomeVariant(overview.currentReview.outcome),
          },
          {
            label: latestDecisionLabel,
            variant: overview.latestDecision ? "info" : "neutral",
          },
          {
            label: `${overview.summary.total} runbook${overview.summary.total === 1 ? "" : "s"}`,
            variant: overview.summary.total > 0 ? "info" : "neutral",
          },
          latestRunbook
            ? {
                label: latestRunbook.statusLabel,
                variant: statusVariant(latestRunbook.status),
              }
            : {
                label: "No saved runbook",
                variant: "neutral" as const,
              },
        ]}
        description="One operator-facing rollout preparation surface. It reuses tenant readiness, pilot review, and the cutover decision trail, then persists a narrow runbook so the next tenant widening discussion is repeatable."
        eyebrow="Rollout runbook"
        title="Tenant Onboarding"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Current rollout baseline</CardTitle>
            <CardDescription>{prepCopy(overview)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Baseline tenant
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {overview.currentReadiness.tenant.slug}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {overview.currentReadiness.tenant.label}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Pilot posture
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {overview.currentReadiness.posture.stageLabel}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {overview.currentReadiness.posture.liveMutationAllowed
                    ? "Live mutations remain explicitly scoped."
                    : "Live mutations remain guarded in this posture."}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Review artifact
                </div>
                <div className="mt-1 break-words font-medium text-[var(--ink)]">
                  {overview.currentReview.artifact.fileName}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Latest decision
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">{latestDecisionLabel}</div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {formatTimestamp(overview.latestDecision?.createdAt)}
                </div>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Blockers
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {overview.currentReadiness.summary.blockers}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Warnings
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {overview.currentReadiness.summary.warnings +
                    overview.currentReview.summary.warningSections}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Saved runbooks
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {overview.summary.total}
                </div>
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Write workspaces
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {overview.currentReadiness.posture.writeWorkspaces.length > 0 ? (
                  overview.currentReadiness.posture.writeWorkspaces.map((workspace) => (
                    <Badge key={workspace} variant="info">
                      {workspace}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="neutral">No explicit write scope</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <TemplateCard items={overview.template.items} />
      </div>

      <TenantOnboardingRunbookPanel
        availabilityNote={availabilityNote}
        initialOverview={overview}
      />

      <DomainApiCard
        description="Tenant onboarding stays bounded. It packages current cutover truth and operator notes into a repeatable runbook that now feeds the latest rollout packet, without turning into tenant provisioning, credential orchestration, or a broad tenant admin plane."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
