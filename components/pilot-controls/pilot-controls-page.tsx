import Link from "next/link";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OperatorRuntimeTruth } from "@/lib/server/runtime-truth";
import type { PilotControlState } from "@/lib/server/pilot-controls";
import { getOperatorTruthBadge } from "@/lib/server/runtime-truth";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Прочитать текущую rollout posture, tenant boundary и blocked workflows для live pilot.",
    path: "/api/pilot-controls",
  },
  {
    method: "POST" as const,
    note: "AI apply остаётся delivery-scoped и теперь проходит через pilot-control guard.",
    path: "/api/ai/runs/:runId/proposals/:proposalId/apply",
  },
  {
    method: "POST" as const,
    note: "Executive brief sends остаются executive-scoped и блокируются вне нужной rollout posture.",
    path: "/api/connectors/email/briefs",
  },
  {
    method: "POST" as const,
    note: "Scheduled digest execution тоже проходит через explicit pilot-control gate.",
    path: "/api/connectors/telegram/briefs/policies/run-due",
  },
];

export function PilotControlsPage({
  blockedWorkflows,
  pilot,
  runtimeTruth,
  stageLabel,
}: {
  blockedWorkflows: Array<{ id: string; label: string }>;
  pilot: PilotControlState;
  runtimeTruth: OperatorRuntimeTruth;
  stageLabel: string;
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
            <Link className={buttonVariants({ variant: "outline" })} href="/briefs">
              Open executive briefs
            </Link>
          </>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          { label: stageLabel, variant: pilot.stage === "observe" ? "warning" : pilot.stage === "open" ? "neutral" : "success" },
          {
            label: pilot.tenantSlug ? `Tenant ${pilot.tenantSlug}` : "Tenant unrestricted",
            variant: pilot.tenantSlug ? "info" : "warning",
          },
          {
            label: pilot.liveMutationAllowed ? "Live mutations allowed" : "Live mutations guarded",
            variant: pilot.liveMutationAllowed ? "success" : "warning",
          },
        ]}
        description="Explicit rollout posture for real pilots. This surface shows which tenant and workspaces are allowed to perform high-risk live workflows, and which flows remain blocked until the pilot is promoted."
        eyebrow="Rollout posture"
        title="Pilot Controls"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Configured posture</CardTitle>
            <CardDescription>
              Narrow pilot model tied to runtime state, explicit stage, and optional tenant boundary.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-[var(--ink-soft)]">
            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Rollout stage</div>
              <div className="mt-2 text-base font-medium text-[var(--ink)]">{stageLabel}</div>
              <div className="mt-1">
                {pilot.configured
                  ? "Configured explicitly via environment."
                  : "Using default open posture because no explicit pilot stage is configured."}
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Tenant boundary</div>
              <div className="mt-2 text-base font-medium text-[var(--ink)]">
                {pilot.tenantSlug ?? "Unrestricted"}
              </div>
              <div className="mt-1">
                {pilot.tenantSlug
                  ? "High-risk workflows are allowed only for the matching organization slug."
                  : "No tenant guard is configured yet."}
              </div>
            </div>

            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Write workspaces</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {pilot.allowedWriteWorkspaces.length > 0 ? (
                  pilot.allowedWriteWorkspaces.map((workspace) => (
                    <Badge key={workspace} variant="info">
                      {workspace}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="warning">No high-risk writes allowed</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Blocked workflows</CardTitle>
            <CardDescription>
              High-risk flows that stay guarded in the current rollout posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {blockedWorkflows.length > 0 ? (
              blockedWorkflows.map((workflow) => (
                <div
                  className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                  key={workflow.id}
                >
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="warning">guarded</Badge>
                    <Badge variant="neutral">{workflow.id}</Badge>
                  </div>
                  <div className="mt-2 font-medium text-[var(--ink)]">{workflow.label}</div>
                </div>
              ))
            ) : (
              <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                No stage-based workflow blocks are active in the current posture.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DomainApiCard
        description="Pilot controls do not create a tenant admin console. They expose one explicit rollout posture and enforce it on the highest-risk routes."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
