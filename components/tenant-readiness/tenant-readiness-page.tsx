import Link from "next/link";

import { CutoverDecisionRegisterPanel } from "@/components/tenant-readiness/cutover-decision-register-panel";
import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CutoverDecisionRegister } from "@/lib/cutover-decisions";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type {
  TenantReadinessChecklistItem,
  TenantReadinessFinding,
  TenantReadinessReport,
} from "@/lib/tenant-readiness";

import {
  categoryLabel,
  expectedEndpoints,
  formatStateLabel,
  outcomeVariant,
  promotionCopy,
  stateVariant,
} from "./tenant-readiness-page-helpers";

function FindingsColumn({
  emptyCopy,
  items,
  title,
}: {
  emptyCopy: string;
  items: TenantReadinessFinding[];
  title: string;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{emptyCopy}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
              key={item.id}
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant={stateVariant(item.state)}>{formatStateLabel(item.state)}</Badge>
                <Badge variant="neutral">{categoryLabel(item.category)}</Badge>
              </div>
              <div className="mt-3 font-medium text-[var(--ink)]">{item.title}</div>
              <div className="mt-2 text-sm text-[var(--ink-soft)]">{item.summary}</div>
              <div className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Next action
              </div>
              <div className="mt-1 text-sm text-[var(--ink)]">{item.action}</div>
              {item.links.length > 0 ? (
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
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            {emptyCopy}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChecklistCard({
  items,
}: {
  items: TenantReadinessChecklistItem[];
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Cutover checklist</CardTitle>
        <CardDescription>
          One read-only checklist over runtime truth, rollout posture, connector readiness,
          and unresolved operator follow-through.
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

export function TenantReadinessPage({
  currentReviewOutcomeLabel,
  decisionAvailabilityNote,
  decisionRegister,
  readiness,
  runtimeTruth,
}: {
  currentReviewOutcomeLabel: string;
  decisionAvailabilityNote?: string;
  decisionRegister: CutoverDecisionRegister;
  readiness: TenantReadinessReport;
  runtimeTruth: OperatorRuntimeTruth;
}) {
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-controls">
              Open pilot controls
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/integrations">
              Open connector health
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/command-center">
              Open command center
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-feedback">
              Open pilot feedback
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-review">
              Open pilot review
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-onboarding">
              Open tenant onboarding
            </Link>
          </>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          { label: readiness.outcomeLabel, variant: outcomeVariant(readiness.outcome) },
          { label: readiness.tenant.slug, variant: "info" },
          {
            label: `${readiness.summary.blockers} blocker${readiness.summary.blockers === 1 ? "" : "s"}`,
            variant: readiness.summary.blockers > 0 ? "danger" : "success",
          },
          {
            label: `${readiness.summary.warnings} warning${readiness.summary.warnings === 1 ? "" : "s"}`,
            variant: readiness.summary.warnings > 0 ? "warning" : "success",
          },
          {
            label: `${readiness.summary.unresolvedExceptions + readiness.summary.unresolvedFeedback} active concern${readiness.summary.unresolvedExceptions + readiness.summary.unresolvedFeedback === 1 ? "" : "s"}`,
            variant:
              readiness.summary.unresolvedExceptions + readiness.summary.unresolvedFeedback > 0
                ? "warning"
                : "success",
          },
          {
            label: `${decisionRegister.summary.total} governance decision${decisionRegister.summary.total === 1 ? "" : "s"}`,
            variant: decisionRegister.summary.total > 0 ? "info" : "neutral",
          },
        ]}
        description="One operator-facing cutover checklist for a single tenant. This surface says whether the tenant is blocked, guarded, or ready to promote, and now records the explicit governance decisions that accept warnings, approve cutover, or trigger rollback."
        eyebrow="Go-live posture"
        title="Tenant Readiness"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Promotion posture</CardTitle>
            <CardDescription>{promotionCopy(readiness.outcome)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Target tenant
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">{readiness.tenant.slug}</div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">{readiness.tenant.label}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Pilot stage
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {readiness.posture.stageLabel}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {readiness.posture.liveMutationAllowed
                    ? "Live mutations are allowed inside the current write scope."
                    : "Live mutations stay guarded in the current posture."}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Write workspaces
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {readiness.posture.writeWorkspaces.length > 0
                    ? readiness.posture.writeWorkspaces.join(", ")
                    : "None"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Viewer context
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {readiness.accessProfile.organizationSlug}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {readiness.accessProfile.role} · {readiness.accessProfile.workspaceId}
                </div>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Blockers
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {readiness.summary.blockers}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Warnings
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {readiness.summary.warnings}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Ready signals
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {readiness.summary.readySignals}
                </div>
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Stage-based blocks
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {readiness.posture.blockedWorkflows.length > 0 ? (
                  readiness.posture.blockedWorkflows.map((workflow) => (
                    <Badge key={workflow.id} variant="warning">
                      {workflow.label}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="success">No stage-based workflow blocks</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <ChecklistCard items={readiness.checklist} />
      </div>

      <CutoverDecisionRegisterPanel
        availabilityNote={decisionAvailabilityNote}
        currentReadinessOutcomeLabel={readiness.outcomeLabel}
        currentReviewOutcomeLabel={currentReviewOutcomeLabel}
        initialRegister={decisionRegister}
        tenantSlug={readiness.tenant.slug}
        warningOptions={readiness.warnings.map((item) => ({
          id: item.id,
          title: item.title,
        }))}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <FindingsColumn
          emptyCopy="No tenant cutover blockers remain in the tracked surfaces."
          items={readiness.blockers}
          title="Blockers"
        />
        <FindingsColumn
          emptyCopy="No explicit warnings remain beyond the current cutover posture."
          items={readiness.warnings}
          title="Warnings"
        />
        <FindingsColumn
          emptyCopy="Readiness signals will appear here once the core surfaces turn green."
          items={readiness.readySignals}
          title="Safe-to-Promote Signals"
        />
      </div>

      <DomainApiCard
        description="Tenant readiness stays narrow. It aggregates existing runtime, connector, rollout, and follow-through surfaces, then records explicit governance decisions without turning into a broad tenant admin plane."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
