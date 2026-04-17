"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, fieldStyles } from "@/components/ui/field";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type {
  PilotReviewDeliveryPolicyExecutionSummary,
  PilotReviewDeliveryPolicyRecord,
} from "@/lib/pilot-review";

import {
  type DeliveryStateErrorPayload,
  type DeliveryStatePayload,
  weekdayOptions,
} from "./pilot-review-delivery-panel-helpers";
import {
  PilotReviewDeliveryHistory,
  PilotReviewDeliveryPolicies,
  PilotReviewDeliveryRunSummary,
} from "./pilot-review-delivery-panel-sections";

export function PilotReviewDeliveryPanel({
  availabilityNote,
  initialHistory,
  initialPolicies,
}: {
  availabilityNote?: string;
  initialHistory: BriefDeliveryLedgerRecord[];
  initialPolicies: PilotReviewDeliveryPolicyRecord[];
}) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [history, setHistory] = useState(initialHistory);
  const [recipient, setRecipient] = useState("");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [deliveryWeekday, setDeliveryWeekday] = useState("1");
  const [deliveryHour, setDeliveryHour] = useState("9");
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] =
    useState<PilotReviewDeliveryPolicyExecutionSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunningDry, setIsRunningDry] = useState(false);
  const [isRunningLive, setIsRunningLive] = useState(false);
  const [togglingPolicyId, setTogglingPolicyId] = useState<string | null>(null);

  async function loadState() {
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/pilot-review/policies", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | (DeliveryStatePayload & DeliveryStateErrorPayload)
        | DeliveryStateErrorPayload;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load governance delivery state.");
      }

      setPolicies((payload as DeliveryStatePayload).policies ?? []);
      setHistory((payload as DeliveryStatePayload).history ?? []);
      setError(null);
    } catch (loadingError) {
      setError(
        loadingError instanceof Error
          ? loadingError.message
          : "Failed to load governance delivery state."
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function createPolicy() {
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/pilot-review/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deliveryHour: Number(deliveryHour),
          deliveryWeekday: Number(deliveryWeekday),
          recipient: recipient.trim() || null,
          timezone: timezone.trim(),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Failed to create governance delivery policy."
        );
      }

      setError(null);
      setRecipient("");
      await loadState();
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : "Failed to create governance delivery policy."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function togglePolicy(policy: PilotReviewDeliveryPolicyRecord) {
    setTogglingPolicyId(policy.id);

    try {
      const response = await fetch(`/api/pilot-review/policies/${policy.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          active: !policy.active,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Failed to update governance delivery policy."
        );
      }

      setPolicies((current) =>
        current.map((entry) =>
          entry.id === policy.id ? (payload as PilotReviewDeliveryPolicyRecord) : entry
        )
      );
      setError(null);
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Failed to update governance delivery policy."
      );
    } finally {
      setTogglingPolicyId(null);
    }
  }

  async function runDue(dryRun: boolean) {
    if (dryRun) {
      setIsRunningDry(true);
    } else {
      setIsRunningLive(true);
    }

    try {
      const response = await fetch("/api/pilot-review/policies/run-due", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dryRun }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Failed to run governance delivery schedule."
        );
      }

      setRunSummary(payload as PilotReviewDeliveryPolicyExecutionSummary);
      setError(null);
      await loadState();
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Failed to run governance delivery schedule."
      );
    } finally {
      if (dryRun) {
        setIsRunningDry(false);
      } else {
        setIsRunningLive(false);
      }
    }
  }

  const canCreatePolicy =
    !availabilityNote &&
    !isSubmitting &&
    timezone.trim().length > 0 &&
    deliveryHour.trim().length > 0 &&
    deliveryWeekday.trim().length > 0;

  return (
    <div className="grid gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--surface-panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--ink)]">
            Recurring governance delivery
          </div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            Weekly pilot review stays narrow: one email schedule, one due-run trigger, one
            durable delivery ledger.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="info">Email only</Badge>
          <Badge variant="info">Weekly cadence</Badge>
          <Badge variant="neutral">Cron-safe</Badge>
        </div>
      </div>

      {availabilityNote ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          {availabilityNote}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[14px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Получатель</span>
          <Input
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Опционально, если настроен EMAIL_DEFAULT_TO"
            value={recipient}
          />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Timezone</span>
          <Input onChange={(event) => setTimezone(event.target.value)} value={timezone} />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>День недели</span>
          <select
            className={fieldStyles}
            onChange={(event) => setDeliveryWeekday(event.target.value)}
            value={deliveryWeekday}
          >
            {weekdayOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Час доставки</span>
          <Input
            max={23}
            min={0}
            onChange={(event) => setDeliveryHour(event.target.value)}
            type="number"
            value={deliveryHour}
          />
        </label>
        <div className="grid gap-2 text-xs text-[var(--ink-soft)]">
          <span className="uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Trigger notes
          </span>
          <div>
            `POST /api/pilot-review/policies/run-due` lets an operator preview or execute the
            current due window.
          </div>
          <div>
            `POST /api/pilot-review/policies/run-due/cron` is the bearer-token companion for
            scheduled runners.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canCreatePolicy} onClick={createPolicy}>
          {isSubmitting ? "Saving schedule..." : "Save weekly schedule"}
        </Button>
        <Button
          disabled={Boolean(availabilityNote) || isRunningDry || isRunningLive}
          onClick={() => runDue(true)}
          variant="secondary"
        >
          {isRunningDry ? "Previewing..." : "Preview due run"}
        </Button>
        <Button
          disabled={Boolean(availabilityNote) || isRunningDry || isRunningLive}
          onClick={() => runDue(false)}
          variant="outline"
        >
          {isRunningLive ? "Running..." : "Run due now"}
        </Button>
        <Button
          disabled={Boolean(availabilityNote) || isRefreshing}
          onClick={loadState}
          variant="ghost"
        >
          {isRefreshing ? "Refreshing..." : "Refresh state"}
        </Button>
      </div>

      <PilotReviewDeliveryRunSummary runSummary={runSummary} />
      <PilotReviewDeliveryPolicies
        onToggle={togglePolicy}
        policies={policies}
        togglingPolicyId={togglingPolicyId}
      />
      <PilotReviewDeliveryHistory history={history} />
    </div>
  );
}
