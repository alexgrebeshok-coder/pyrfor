"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

import { AIRunComparisonCard } from "@/components/ai/ai-run-comparison-card";
import { AIRunTracePanel } from "@/components/ai/ai-run-trace-panel";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client/api-error";
import type { AIRunTrace } from "@/lib/ai/trace";
import type { AIRunRecord } from "@/lib/ai/types";
import { buildAIRunTraceComparison } from "@/lib/ai/trace-comparison";

const fetcher = (url: string) => api.get<AIRunTrace>(url);

export function AIRunInspector({
  locale,
  runId,
}: {
  locale?: string;
  runId: string;
}) {
  const [activeRunId, setActiveRunId] = useState(runId);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);

  useEffect(() => {
    setActiveRunId(runId);
  }, [runId]);

  const { data, error, isLoading, mutate } = useSWR(
    activeRunId ? `/api/ai/runs/${activeRunId}/trace` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const replaySourceRunId = data?.source.replayOfRunId ?? null;
  const {
    data: originalTrace,
    error: originalTraceError,
    isLoading: isOriginalTraceLoading,
  } = useSWR(
    replaySourceRunId ? `/api/ai/runs/${replaySourceRunId}/trace` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const traceErrorMessage = error instanceof Error ? error.message : null;
  const panelError = traceErrorMessage && !data ? traceErrorMessage : null;
  const originalTraceErrorMessage = originalTraceError instanceof Error ? originalTraceError.message : null;
  const comparison =
    data && originalTrace ? buildAIRunTraceComparison(originalTrace, data) : null;

  const handleReplay = async () => {
    if (!activeRunId || isReplaying) {
      return;
    }

    setIsReplaying(true);
    setReplayError(null);

    try {
      const replayed = await api.post<AIRunRecord>(`/api/ai/runs/${activeRunId}/replay`, {});
      setActiveRunId(replayed.id);
    } catch (replayErr) {
      setReplayError(replayErr instanceof Error ? replayErr.message : "Failed to replay run.");
    } finally {
      setIsReplaying(false);
    }
  };

  if (!isLoading && !traceErrorMessage && !data) {
    return null;
  }

  return (
    <section className="grid gap-3 rounded-[28px] border border-[var(--line)] bg-[color:var(--surface-panel)]/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Execution trace
          </p>
          <p className="text-sm leading-6 text-[var(--ink-soft)]">
            Live trace for the selected run: facts loaded, council steps, proposal safety, and apply result.
          </p>
        </div>
        <Badge variant={traceErrorMessage ? "danger" : data ? "success" : "info"}>
          {traceErrorMessage ? "Trace error" : data ? "Loaded" : "Loading"}
        </Badge>
      </div>

      {replayError ? (
        <div className="rounded-[14px] border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {replayError}
        </div>
      ) : null}

      <AIRunTracePanel
        error={panelError}
        isLoading={isLoading}
        isReplaying={isReplaying}
        locale={locale}
        onRefresh={() => void mutate()}
        onReplay={handleReplay}
        trace={data ?? null}
      />

      {originalTraceErrorMessage ? (
        <div className="rounded-[14px] border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Replay comparison unavailable: {originalTraceErrorMessage}
        </div>
      ) : null}

      {isOriginalTraceLoading && data?.source.replayOfRunId ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
          Loading original run for comparison...
        </div>
      ) : null}

      {comparison ? <AIRunComparisonCard comparison={comparison} /> : null}
    </section>
  );
}
