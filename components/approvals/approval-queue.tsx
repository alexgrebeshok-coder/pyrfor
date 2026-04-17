"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";

interface Approval {
  id: string;
  type: string;
  entityType: string;
  entityId: string | null;
  title: string;
  description: string | null;
  status: string;
  comment: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  reviewedAt: string | null;
  requestedBy: { id: string; name: string | null; email: string | null } | null;
  reviewedBy: { id: string; name: string | null; email: string | null } | null;
}

type TabFilter = "pending" | "approved" | "rejected" | "all";

interface WorkReportApprovalMetadata {
  canonicalPath?: string;
  projectName?: string;
  reportNumber?: string;
  reportStatus?: string;
  section?: string;
}

interface WorkflowApprovalMetadata {
  canonicalPath?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  workflowNodeName?: string;
}

function resolveWorkReportApprovalMetadata(approval: Approval): WorkReportApprovalMetadata | null {
  if (approval.entityType !== "work_report" || !approval.metadata) {
    return null;
  }

  return approval.metadata as WorkReportApprovalMetadata;
}

function resolveWorkflowApprovalMetadata(approval: Approval): WorkflowApprovalMetadata | null {
  if (approval.entityType !== "orchestration_workflow_run" || !approval.metadata) {
    return null;
  }

  return approval.metadata as WorkflowApprovalMetadata;
}

export function ApprovalQueue() {
  const { allowed: canReviewApprovals } = usePlatformPermission("RUN_AI_ACTIONS");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<TabFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approvals?status=${tab}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleReview = async (id: string, action: "approve" | "reject") => {
    if (!canReviewApprovals) {
      return;
    }

    const res = await fetch(`/api/approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, comment: comment || undefined }),
    });

    if (res.ok) {
      setReviewingId(null);
      setComment("");
      fetchApprovals();
    }
  };

  const typeLabels: Record<string, string> = {
    task_creation: "Создание задачи",
    risk_mitigation: "Митигация риска",
    budget_change: "Изменение бюджета",
    report_publish: "Публикация отчёта",
    work_report_review: "Review полевого отчёта",
    ai_action: "AI действие",
    workflow_gate: "Workflow gate",
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    expired: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "pending", label: "Ожидают" },
    { key: "approved", label: "Одобрено" },
    { key: "rejected", label: "Отклонено" },
    { key: "all", label: "Все" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Согласования</h2>
        <span className="text-sm text-muted-foreground">
          {total} записей
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Загрузка...</div>
      ) : approvals.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {tab === "pending" ? "Нет ожидающих согласований ✅" : "Нет записей"}
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => {
            const workReportMetadata = resolveWorkReportApprovalMetadata(a);
            const workflowMetadata = resolveWorkflowApprovalMetadata(a);
            const workReportPath =
              workReportMetadata?.canonicalPath ??
              (a.entityType === "work_report" && a.entityId
                ? `/work-reports?reportId=${encodeURIComponent(a.entityId)}#review-workspace`
                : null);
            const isWorkReportApproval = a.entityType === "work_report";
            const workflowPath =
              workflowMetadata?.canonicalPath ??
              (a.entityType === "orchestration_workflow_run" && a.entityId
                ? `/settings/agents/workflows/runs/${encodeURIComponent(a.entityId)}`
                : null);

            return (
              <div
                key={a.id}
                className="rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[a.status] ?? ""}`}>
                      {a.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {typeLabels[a.type] ?? a.type}
                    </span>
                  </div>
                  <h3 className="font-medium">{a.title}</h3>
                  {a.description && (
                    <p className="text-sm text-muted-foreground">{a.description}</p>
                  )}
                  {workReportMetadata ? (
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      {workReportMetadata.projectName ? (
                        <span>Проект: {workReportMetadata.projectName}</span>
                      ) : null}
                      {workReportMetadata.reportNumber ? (
                        <span>Отчёт: {workReportMetadata.reportNumber}</span>
                      ) : null}
                      {workReportMetadata.section ? (
                        <span>Секция: {workReportMetadata.section}</span>
                      ) : null}
                      {workReportMetadata.reportStatus ? (
                        <span>Статус отчёта: {workReportMetadata.reportStatus}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {a.requestedBy && (
                      <span>От: {a.requestedBy.name ?? a.requestedBy.email}</span>
                    )}
                    <span>{new Date(a.createdAt).toLocaleString("ru-RU")}</span>
                    {a.reviewedBy && a.reviewedAt && (
                      <span>
                        Рецензент: {a.reviewedBy.name ?? a.reviewedBy.email} •{" "}
                        {new Date(a.reviewedAt).toLocaleString("ru-RU")}
                      </span>
                    )}
                  </div>
                  {a.comment && (
                    <p className="mt-1 text-sm italic text-muted-foreground">
                      💬 {a.comment}
                    </p>
                  )}
                  {isWorkReportApproval ? (
                    <p className="text-xs text-muted-foreground">
                      Canonical action surface для work-report approvals — dedicated review workspace.
                    </p>
                  ) : workflowPath ? (
                    <p className="text-xs text-muted-foreground">
                      Workflow gate связан с orchestration run и может быть открыт в workflow inspector.
                    </p>
                  ) : null}
                  </div>

                  <div className="flex gap-2">
                    {isWorkReportApproval && workReportPath ? (
                      <Link
                        className="rounded border px-3 py-1 text-sm font-medium hover:bg-muted"
                        href={workReportPath}
                        >
                          {a.status === "pending" ? "Открыть review workspace" : "Открыть отчёт"}
                        </Link>
                    ) : workflowPath ? (
                      <Link
                        className="rounded border px-3 py-1 text-sm font-medium hover:bg-muted"
                        href={workflowPath}
                      >
                        {a.status === "pending" ? "Открыть workflow gate" : "Открыть workflow"}
                      </Link>
                    ) : null}

                    {a.status === "pending" && !isWorkReportApproval ? (
                      !canReviewApprovals ? (
                        <p className="max-w-[220px] text-xs text-muted-foreground">
                          Review controls доступны только ролям с правом RUN_AI_ACTIONS.
                        </p>
                      ) : reviewingId === a.id ? (
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            placeholder="Комментарий (необязательно)"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            className="rounded border px-2 py-1 text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleReview(a.id, "approve")}
                              className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
                            >
                              ✅ Одобрить
                            </button>
                            <button
                              onClick={() => handleReview(a.id, "reject")}
                              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
                            >
                              ❌ Отклонить
                            </button>
                            <button
                              onClick={() => { setReviewingId(null); setComment(""); }}
                              className="rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                            >
                              Отмена
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReviewingId(a.id)}
                          className="rounded border px-3 py-1 text-sm font-medium hover:bg-muted"
                        >
                          Рассмотреть
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
