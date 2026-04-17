"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { buttonVariants } from "@/components/ui/button";
import type {
  PilotFeedbackItemView,
  PilotFeedbackListResult,
  PilotFeedbackStatus,
} from "@/lib/pilot-feedback";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type { WorkReportMemberOption } from "@/lib/work-reports/types";

import { PilotFeedbackForm } from "@/components/pilot-feedback/pilot-feedback-form";
import { PilotFeedbackLedger } from "@/components/pilot-feedback/pilot-feedback-ledger";
import {
  emptyFormState,
  expectedEndpoints,
  type FeedbackFormState,
  type PilotFeedbackTargetPrefill,
} from "@/components/pilot-feedback/pilot-feedback-utils";

export function PilotFeedbackPage({
  initialFeedback,
  initialTarget,
  liveFeedbackReady,
  members,
  runtimeTruth,
  fallbackNote,
}: {
  initialFeedback: PilotFeedbackListResult;
  initialTarget: PilotFeedbackTargetPrefill;
  liveFeedbackReady: boolean;
  members: WorkReportMemberOption[];
  runtimeTruth: OperatorRuntimeTruth;
  fallbackNote?: string;
}) {
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FeedbackFormState>({
    ...emptyFormState,
    ...initialTarget,
  });

  useEffect(() => {
    setFormState((current) => ({
      ...current,
      ...initialTarget,
      targetType: initialTarget.targetType,
    }));
  }, [initialTarget]);

  const updateForm = (updates: Partial<FeedbackFormState>) => {
    setFormState((current) => ({
      ...current,
      ...updates,
    }));
  };

  const reloadFeedback = async () => {
    const response = await fetch("/api/pilot-feedback?includeResolved=true&limit=24", {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "Не удалось обновить pilot feedback ledger.");
    }

    setFeedback(payload as PilotFeedbackListResult);
  };

  const createFeedback = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/pilot-feedback", {
        body: JSON.stringify({
          details: formState.details || null,
          ownerId: formState.ownerId || null,
          projectId: formState.projectId || null,
          projectName: formState.projectName || null,
          severity: formState.severity,
          sourceHref: formState.sourceHref || null,
          sourceLabel: formState.sourceLabel || null,
          summary: formState.summary,
          targetId: formState.targetId,
          targetLabel: formState.targetLabel,
          targetType: formState.targetType,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось создать pilot feedback item.");
      }

      await reloadFeedback();
      setFormState((current) => ({
        ...emptyFormState,
        ...initialTarget,
        targetType: current.targetType,
      }));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Не удалось создать pilot feedback item."
      );
    } finally {
      setIsCreating(false);
    }
  };

  const updateFeedback = async (
    item: PilotFeedbackItemView,
    body: {
      ownerId?: string | null;
      status?: PilotFeedbackStatus;
    }
  ) => {
    setSavingId(item.id);
    setError(null);

    try {
      const response = await fetch(`/api/pilot-feedback/${item.id}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось обновить pilot feedback item.");
      }

      await reloadFeedback();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Не удалось обновить pilot feedback item."
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/command-center">
              Open command center
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/audit-packs">
              Open audit packs
            </Link>
          </>
        }
        chips={[
          ...(fallbackNote ? [{ label: fallbackNote, variant: "warning" as const }] : []),
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          {
            label:
              feedback.summary.total > 0
                ? `${feedback.summary.total} feedback item${feedback.summary.total === 1 ? "" : "s"}`
                : "No feedback yet",
            variant: feedback.summary.total > 0 ? "info" : "neutral",
          },
          {
            label:
              feedback.summary.open + feedback.summary.inReview > 0
                ? `${feedback.summary.open + feedback.summary.inReview} still active`
                : "No active feedback",
            variant:
              feedback.summary.open + feedback.summary.inReview > 0
                ? "warning"
                : "success",
          },
          {
            label:
              feedback.summary.critical + feedback.summary.high > 0
                ? `${feedback.summary.critical + feedback.summary.high} critical/high`
                : "No critical feedback",
            variant:
              feedback.summary.critical + feedback.summary.high > 0
                ? "danger"
                : "success",
          },
        ]}
        description="Persisted pilot feedback ledger linked to real workflow artifacts. This surface turns audit comments and command-center follow-through into managed product truth with explicit ownership and closure state."
        eyebrow="Pilot loop"
        title="Pilot Feedback"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
        <PilotFeedbackForm
          error={error}
          formState={formState}
          isCreating={isCreating}
          liveFeedbackReady={liveFeedbackReady}
          members={members}
          onChange={updateForm}
          onSubmit={createFeedback}
        />
        <PilotFeedbackLedger
          feedback={feedback}
          liveFeedbackReady={liveFeedbackReady}
          members={members}
          savingId={savingId}
          onUpdateFeedback={updateFeedback}
        />
      </div>

      <DomainApiCard
        description="Pilot feedback stays narrow: one persisted ledger over existing command and audit workflows instead of a broad ticketing subsystem."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
