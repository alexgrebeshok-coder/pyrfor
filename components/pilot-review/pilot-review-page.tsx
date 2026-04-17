import Link from "next/link";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { PilotReviewDeliveryPanel } from "@/components/pilot-review/pilot-review-delivery-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type {
  PilotReviewDeliveryPolicyRecord,
  PilotReviewScorecard,
} from "@/lib/pilot-review";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";

import {
  expectedEndpoints,
  formatStateLabel,
  formatTimestamp,
  outcomeVariant,
  reviewCopy,
  stateVariant,
} from "./pilot-review-page-helpers";

export function PilotReviewPage({
  deliveryAvailabilityNote,
  deliveryHistory,
  deliveryPolicies,
  runtimeTruth,
  scorecard,
}: {
  deliveryAvailabilityNote?: string;
  deliveryHistory: BriefDeliveryLedgerRecord[];
  deliveryPolicies: PilotReviewDeliveryPolicyRecord[];
  runtimeTruth: OperatorRuntimeTruth;
  scorecard: PilotReviewScorecard;
}) {
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);
  const activeConcerns = scorecard.summary.openExceptions + scorecard.summary.openFeedback;

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-readiness">
              Open tenant readiness
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/command-center">
              Open command center
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-feedback">
              Open pilot feedback
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-onboarding">
              Open tenant onboarding
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/tenant-rollout-packet">
              Open rollout packet
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/briefs">
              Open executive briefs
            </Link>
          </>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          { label: scorecard.outcomeLabel, variant: outcomeVariant(scorecard.outcome) },
          {
            label: `${scorecard.summary.blockedSections} blocked section${scorecard.summary.blockedSections === 1 ? "" : "s"}`,
            variant: scorecard.summary.blockedSections > 0 ? "danger" : "success",
          },
          {
            label: `${scorecard.summary.warningSections} warning section${scorecard.summary.warningSections === 1 ? "" : "s"}`,
            variant: scorecard.summary.warningSections > 0 ? "warning" : "success",
          },
          {
            label: `${activeConcerns} active concern${activeConcerns === 1 ? "" : "s"}`,
            variant: activeConcerns > 0 ? "warning" : "success",
          },
          {
            label: scorecard.artifact.format.toUpperCase(),
            variant: "info",
          },
        ]}
        description="One operator-facing weekly pilot review surface. This scorecard turns readiness, backlog aging, delivery health, freshness lag, and pilot feedback into one deterministic governance artifact and one export path."
        eyebrow="Governance review"
        title="Pilot Review"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Review posture</CardTitle>
            <CardDescription>{reviewCopy(scorecard.outcome)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Review outcome
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">{scorecard.outcomeLabel}</div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  Generated {formatTimestamp(scorecard.generatedAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Tenant scope
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {scorecard.readiness.tenant.slug}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {scorecard.readiness.posture.stageLabel}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Viewer context
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {scorecard.accessProfile.organizationSlug}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-soft)]">
                  {scorecard.accessProfile.role} · {scorecard.accessProfile.workspaceId}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Artifact file
                </div>
                <div className="mt-1 break-words font-medium text-[var(--ink)]">
                  {scorecard.artifact.fileName}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Blocked sections
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {scorecard.summary.blockedSections}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Warning sections
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {scorecard.summary.warningSections}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Stale signals
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {scorecard.summary.staleSignals}
                </div>
              </div>
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Delivery failures
                </div>
                <div className="mt-1 text-xl md:text-2xl font-semibold text-[var(--ink)]">
                  {scorecard.summary.deliveryFailures}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Governance export</CardTitle>
                <CardDescription>
                  The same scorecard can be read in-app or exported as deterministic markdown for recurring steering review.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href="/api/pilot-review?format=markdown"
                  rel="noreferrer"
                  target="_blank"
                >
                  Inspect markdown
                </Link>
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href="/api/pilot-review?format=markdown&download=1"
                  rel="noreferrer"
                  target="_blank"
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
                  Format
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {scorecard.artifact.format}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Media type
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {scorecard.artifact.mediaType}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Generated
                </div>
                <div className="mt-1 font-medium text-[var(--ink)]">
                  {formatTimestamp(scorecard.generatedAt)}
                </div>
              </div>
            </div>

            <pre className="max-h-[420px] overflow-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] p-4 text-xs leading-6 text-[var(--ink)]">
              {scorecard.artifact.content}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Scorecard sections</CardTitle>
          <CardDescription>
            One deterministic review across rollout readiness, exception backlog, pilot
            feedback, delivery history, and freshness lag.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {scorecard.sections.map((section) => (
            <div
              className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
              key={section.id}
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant={stateVariant(section)}>
                  {formatStateLabel(section.state)}
                </Badge>
              </div>
              <div className="mt-3 font-medium text-[var(--ink)]">{section.label}</div>
              <div className="mt-2 text-sm text-[var(--ink-soft)]">{section.summary}</div>
              <div className="mt-4 grid gap-2 text-sm text-[var(--ink-soft)]">
                {section.metrics.map((metric) => (
                  <div
                    className="flex items-start justify-between gap-3"
                    key={`${section.id}:${metric.label}`}
                  >
                    <span>{metric.label}</span>
                    <span className="text-right font-medium text-[var(--ink)]">
                      {metric.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
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
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Freshness signals</CardTitle>
            <CardDescription>
              Explicit sync checkpoints reused from existing derived-truth jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {scorecard.freshness.map((signal) => (
              <div
                className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                key={signal.id}
              >
                <div className="flex flex-wrap gap-2">
                  <Badge variant={stateVariant(signal)}>{formatStateLabel(signal.state)}</Badge>
                  <Badge variant="neutral">{signal.status}</Badge>
                </div>
                <div className="mt-3 font-medium text-[var(--ink)]">{signal.label}</div>
                <div className="mt-2 text-sm text-[var(--ink-soft)]">{signal.summary}</div>
                <div className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Last success
                </div>
                <div className="mt-1 text-sm font-medium text-[var(--ink)]">
                  {formatTimestamp(signal.lastSuccessAt)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {signal.links.map((link) => (
                    <Link
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                      href={link.href}
                      key={`${signal.id}:${link.href}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <PilotReviewDeliveryPanel
          availabilityNote={deliveryAvailabilityNote}
          initialHistory={deliveryHistory}
          initialPolicies={deliveryPolicies}
        />
      </div>

      <DomainApiCard
        description="Pilot review stays narrow and deterministic. It reuses readiness, backlog, sync, and delivery surfaces instead of introducing a general reporting layer."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
