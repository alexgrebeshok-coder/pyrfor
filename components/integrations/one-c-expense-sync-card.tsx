"use client";

import { useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/client/api-error";

type OneCExpenseSyncPreview = {
  configured: boolean;
  sourceStatus: "ok" | "pending" | "degraded";
  checkedAt: string;
  missingSecrets: string[];
  summary: {
    sourceProjectCount: number;
    matchedProjectCount: number;
    readyToSyncCount: number;
    skippedCount: number;
  };
  items: Array<{
    oneCRef: string;
    sourceProjectName: string | null;
    matchedProjectName: string | null;
    amount: number;
    currency: string;
    date: string;
    action: "upsert" | "skip";
    reason?: string;
    budgetDeltaStatus: "on_plan" | "over_plan" | "under_plan" | "unknown";
  }>;
  created?: number;
  updated?: number;
};

function formatAmount(value: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function OneCExpenseSyncCard() {
  const [isSyncing, setIsSyncing] = useState(false);
  const { data, mutate, isLoading } = useSWR<OneCExpenseSyncPreview>(
    "/api/connectors/one-c/expenses",
    (url: string) => api.get<OneCExpenseSyncPreview>(url)
  );

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await api.post<OneCExpenseSyncPreview>("/api/connectors/one-c/expenses", {});
      await mutate();
    } catch (error) {
      console.error("1C expense sync failed:", error);
      alert("Не удалось выполнить 1C sync. Проверьте консоль.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>1C → Expense sync</CardTitle>
            <CardDescription>
              Preview показывает, какие 1C finance truth records могут быть upsert в `Expense` как
              latest actual budget snapshot.
            </CardDescription>
          </div>
          <Button onClick={handleSync} disabled={isLoading || isSyncing || !data?.configured}>
            {isSyncing ? "Sync..." : "Run sync"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label="Source projects" value={`${data?.summary.sourceProjectCount ?? 0}`} />
          <Summary label="Matched" value={`${data?.summary.matchedProjectCount ?? 0}`} />
          <Summary label="Ready" value={`${data?.summary.readyToSyncCount ?? 0}`} />
          <Summary label="Skipped" value={`${data?.summary.skippedCount ?? 0}`} />
        </div>

        {data?.missingSecrets.length ? (
          <div className="rounded-[16px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Missing secrets: {data.missingSecrets.join(", ")}
          </div>
        ) : null}

        <div className="grid gap-3">
          {(data?.items ?? []).slice(0, 6).map((item) => (
            <div
              key={item.oneCRef}
              className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--ink)]">
                    {item.sourceProjectName ?? item.oneCRef}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-soft)]">
                    {item.matchedProjectName ? `→ ${item.matchedProjectName}` : item.reason ?? "No mapping"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={item.action === "upsert" ? "success" : "warning"}>
                    {item.action}
                  </Badge>
                  <Badge variant={item.budgetDeltaStatus === "over_plan" ? "danger" : "info"}>
                    {item.budgetDeltaStatus}
                  </Badge>
                </div>
              </div>
              <div className="mt-2 text-sm text-[var(--ink-soft)]">
                {formatAmount(item.amount, item.currency)} · {new Date(item.date).toLocaleDateString("ru-RU")}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">{label}</div>
      <div className="mt-2 text-lg font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}
